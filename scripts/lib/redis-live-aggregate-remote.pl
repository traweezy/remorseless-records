use strict;
use warnings;
use bytes;
use Cwd qw(realpath);
use Digest::SHA qw(sha256_hex);
use Encode qw(decode FB_CROAK);
use IO::Socket::INET;
use JSON::PP qw(decode_json encode_json);
use MIME::Base64 qw(decode_base64);
use Time::HiRes qw(alarm time);

# Only the final fixed aggregate crosses SSH. Redis replies, key names, and
# protocol errors stay inside the pinned container.
$SIG{ALRM} = sub { die "aggregate deadline\n" };
$SIG{PIPE} = sub { die "aggregate channel closed\n" };
alarm(25);
my $request = decode_json(decode_base64($ARGV[0] // die "missing request\n"));
die "invalid request\n" unless ref($request) eq 'HASH' &&
  ($request->{mode} // '') eq 'aggregate' &&
  ($request->{runIdSha256} // '') =~ /^[a-f0-9]{64}$/;
die "missing password\n" unless defined $ENV{REDIS_PASSWORD} && length($ENV{REDIS_PASSWORD});
for my $pair (
  [projectId => 'RAILWAY_PROJECT_ID'],
  [environmentId => 'RAILWAY_ENVIRONMENT_ID'],
  [serviceId => 'RAILWAY_SERVICE_ID'],
  [deploymentId => 'RAILWAY_DEPLOYMENT_ID'],
  [instanceId => 'RAILWAY_REPLICA_ID'],
  [volumeId => 'RAILWAY_VOLUME_ID'],
  [mountPath => 'RAILWAY_VOLUME_MOUNT_PATH'],
) {
  die "source identity changed\n" unless defined $request->{$pair->[0]} &&
    ($ENV{$pair->[1]} // '') eq $request->{$pair->[0]};
}
die "invalid mount\n" unless ($request->{mountPath} // '') eq '/bitnami';

my $socket = IO::Socket::INET->new(
  PeerAddr => '127.0.0.1', PeerPort => 6379, Proto => 'tcp', Timeout => 2,
) or die "Redis unavailable\n";
$socket->autoflush(1);
my $input = '';
my $wire_bytes = 0;
my %seen_keys;
my $deadline = time() + 20;

sub fail { die "Redis aggregate unavailable\n" }
sub read_more {
  fail() if time() >= $deadline;
  my $read = sysread($socket, my $part, 4096);
  fail() unless defined $read && $read > 0;
  $wire_bytes += $read;
  fail() if $wire_bytes > 8 * 1024 * 1024;
  $input .= $part;
}
sub read_line {
  while (index($input, "\r\n") < 0) {
    fail() if length($input) > 65536;
    read_more();
  }
  my $end = index($input, "\r\n");
  fail() if $end > 65536;
  my $line = substr($input, 0, $end);
  substr($input, 0, $end + 2, '');
  return $line;
}
sub read_exact {
  my ($length) = @_;
  fail() if $length < 0 || $length > 65536;
  read_more() while length($input) < $length + 2;
  my $bytes = substr($input, 0, $length);
  fail() unless substr($input, $length, 2) eq "\r\n";
  substr($input, 0, $length + 2, '');
  return $bytes;
}
sub read_reply {
  my ($depth) = @_;
  fail() if $depth > 3;
  my $marker = read_exact_marker();
  if ($marker eq '+' || $marker eq '-' || $marker eq ':') {
    my $line = read_line();
    fail() if $marker eq '-';
    fail() if $marker eq ':' && $line !~ /^-?(?:0|[1-9][0-9]{0,15})$/;
    return $marker eq ':' ? 0 + $line : $line;
  }
  fail() unless $marker eq '$' || $marker eq '*';
  my $length = read_line();
  fail() unless $length =~ /^(?:-1|0|[1-9][0-9]{0,5})$/;
  return undef if $length eq '-1';
  return read_exact(0 + $length) if $marker eq '$';
  fail() if $length > 512;
  my @items;
  push @items, read_reply($depth + 1) for 1 .. $length;
  return \@items;
}
sub read_exact_marker {
  read_more() unless length($input);
  return substr($input, 0, 1, '');
}
sub send_command {
  my (@parts) = @_;
  my $wire = '*' . scalar(@parts) . "\r\n";
  for my $part (@parts) {
    fail() unless defined $part && !ref($part) && length($part) <= 1024;
    $wire .= '$' . length($part) . "\r\n" . $part . "\r\n";
  }
  my $offset = 0;
  while ($offset < length($wire)) {
    my $written = syswrite($socket, $wire, length($wire) - $offset, $offset);
    fail() unless defined $written && $written > 0;
    $offset += $written;
  }
  return read_reply(0);
}
sub redis {
  my ($command, @args) = @_;
  if ($command eq 'INFO') {
    fail() unless @args == 1 && $args[0] =~ /^(?:server|persistence|replication|keyspace)$/;
  } elsif ($command eq 'CONFIG') {
    fail() unless @args == 2 && $args[0] eq 'GET' &&
      $args[1] =~ /^(?:appendonly|appendfsync|appendfilename|appenddirname|dir)$/;
  } elsif ($command eq 'SCAN') {
    fail() unless @args == 3 && $args[0] =~ /^(?:0|[1-9][0-9]{0,19})$/ &&
      $args[1] eq 'COUNT' && $args[2] eq '128';
  } elsif ($command eq 'DBSIZE') {
    fail() unless @args == 0;
  } elsif ($command eq 'TYPE' || $command eq 'PTTL') {
    fail() unless @args == 1 && exists $seen_keys{$args[0]};
  } elsif ($command =~ /^(?:LLEN|ZCARD|SCARD|XLEN|HLEN)$/) {
    fail() unless @args == 1 && exists $seen_keys{$args[0]} &&
      $args[0] =~ /^(?:RedisEventBusService:events-queue|bull:medusa-workflows|bull:medusa-workflows-jobs|bull:workflows-cleaner):(?:wait|active|paused|delayed|prioritized|completed|failed|waiting-children|repeat|stalled|events|meta)$/;
  } else { fail() }
  return send_command($command, @args);
}

fail() unless send_command('AUTH', $ENV{REDIS_PASSWORD}) eq 'OK';
sub info {
  my ($section) = @_;
  my $raw = redis('INFO', $section);
  fail() unless defined $raw && !ref($raw) && length($raw) <= 65536;
  my %values;
  for my $line (split /\n/, $raw) {
    $line =~ s/\r$//;
    next if $line eq '' || $line =~ /^#/;
    my ($name, $value) = split /:/, $line, 2;
    fail() unless defined $value && $name =~ /^[a-z0-9_]+$/ && !exists $values{$name};
    $values{$name} = $value;
  }
  return \%values;
}
sub config {
  my ($name) = @_;
  my $reply = redis('CONFIG', 'GET', $name);
  fail() unless ref($reply) eq 'ARRAY' && @$reply == 2 &&
    $reply->[0] eq $name && defined $reply->[1] && !ref($reply->[1]);
  return $reply->[1];
}
sub source_state {
  my $server = info('server');
  my $persistence = info('persistence');
  my $replication = info('replication');
  my $keyspace = info('keyspace');
  fail() unless ($server->{redis_version} // '') eq '8.0.3' &&
    ($server->{run_id} // '') =~ /^[a-f0-9]{40}$/ &&
    sha256_hex($server->{run_id}) eq $request->{runIdSha256} &&
    ($replication->{role} // '') eq 'master' &&
    ($persistence->{aof_enabled} // '') eq '1' &&
    ($persistence->{aof_rewrite_in_progress} // '') eq '0' &&
    ($persistence->{aof_rewrite_scheduled} // '') eq '0' &&
    ($persistence->{aof_last_write_status} // '') eq 'ok' &&
    ($persistence->{aof_last_bgrewrite_status} // '') eq 'ok';
  fail() unless config('appendonly') eq 'yes' &&
    config('appendfsync') eq 'everysec' &&
    config('appendfilename') eq 'appendonly.aof' &&
    config('appenddirname') eq 'appendonlydir';
  my $data_dir = config('dir');
  fail() unless $data_dir =~ m{^/bitnami(?:/[a-zA-Z0-9._-]+)+$} &&
    realpath($data_dir) eq $data_dir &&
    realpath("$data_dir/appendonlydir") eq "$data_dir/appendonlydir";
  my $path = '';
  for my $part (split '/', "$data_dir/appendonlydir") {
    next unless length $part;
    $path .= "/$part";
    fail() if -l $path;
  }
  fail() if grep { $_ ne 'db0' } keys %$keyspace;
  my $declared_keys = 0;
  if (exists $keyspace->{db0}) {
    fail() unless $keyspace->{db0} =~
      /^keys=(0|[1-9][0-9]{0,4}),expires=(?:0|[1-9][0-9]{0,4}),avg_ttl=(?:0|[1-9][0-9]{0,15})(?:,subexpiry=(?:0|[1-9][0-9]{0,4}))?$/;
    $declared_keys = 0 + $1;
  }
  my $dbsize = redis('DBSIZE');
  fail() unless defined $dbsize && !ref($dbsize) &&
    $dbsize =~ /^(?:0|[1-9][0-9]{0,4})$/ &&
    $dbsize <= 5000 && $dbsize == $declared_keys;
  return { runIdSha256 => sha256_hex($server->{run_id}), db0Keys => $dbsize };
}

my $before = source_state();
my @queue_defs = (
  ['eventBus', 'RedisEventBusService:events-queue'],
  ['workflows', 'bull:medusa-workflows'],
  ['scheduledJobs', 'bull:medusa-workflows-jobs'],
  ['cleaner', 'bull:workflows-cleaner'],
);
my @states = (
  ['wait', 'list', 'LLEN'], ['active', 'list', 'LLEN'],
  ['paused', 'list', 'LLEN'], ['delayed', 'zset', 'ZCARD'],
  ['prioritized', 'zset', 'ZCARD'], ['completed', 'zset', 'ZCARD'],
  ['failed', 'zset', 'ZCARD'], ['waiting-children', 'zset', 'ZCARD'],
  ['repeat', 'zset', 'ZCARD'], ['stalled', 'set', 'SCARD'],
  ['events', 'stream', 'XLEN'], ['meta', 'hash', 'HLEN'],
);
my @categories = (map($_->[0], @queue_defs), qw(
  medusaLocks workflowCheckpointLocks workflowCheckpoints cartIdempotencyLocks
  cartIdempotencyResults healthSnapshots rateLimits other
));
my @types = qw(string list set zset hash stream other);
my @ttls = qw(persistent under30Seconds under10Minutes over10Minutes vanishedDuringScan);
sub category {
  my ($key) = @_;
  for my $definition (@queue_defs) {
    return $definition->[0] if index($key, "$definition->[1]:") == 0;
  }
  return 'medusaLocks' if index($key, 'medusa_lock:') == 0;
  if (index($key, 'dtrx:') == 0) {
    return $key =~ /:lock$/ ? 'workflowCheckpointLocks' : 'workflowCheckpoints';
  }
  if (index($key, 'rr:cart:idempotency:v1:') == 0) {
    return $key =~ /:lock$/ ? 'cartIdempotencyLocks' : 'cartIdempotencyResults';
  }
  return 'healthSnapshots' if index($key, 'rr:health:') == 0;
  return 'rateLimits' if index($key, 'rr:rate:v1:') == 0;
  return 'other';
}
my $cursor = '0';
my %cursors;
my $scanned_bytes = 0;
my $pages = 0;
do {
  fail() if time() >= $deadline || $pages++ >= 256 || $cursors{$cursor}++;
  my $reply = redis('SCAN', $cursor, 'COUNT', '128');
  fail() unless ref($reply) eq 'ARRAY' && @$reply == 2 &&
    defined $reply->[0] && !ref($reply->[0]) &&
    $reply->[0] =~ /^(?:0|[1-9][0-9]{0,19})$/ &&
    (length($reply->[0]) < 20 || $reply->[0] le '18446744073709551615') &&
    ref($reply->[1]) eq 'ARRAY' && @{$reply->[1]} <= 512;
  for my $key (@{$reply->[1]}) {
    fail() unless defined $key && !ref($key) && length($key) > 0 &&
      length($key) <= 1024 && index($key, "\0") < 0 &&
      index($key, "\xEF\xBF\xBD") < 0;
    my $copy = $key;
    eval { decode('UTF-8', $copy, FB_CROAK); 1 } or fail();
    next if exists $seen_keys{$key};
    $scanned_bytes += length($key);
    fail() if keys(%seen_keys) >= 5000 || $scanned_bytes > 2 * 1024 * 1024;
    $seen_keys{$key} = 1;
  }
  $cursor = $reply->[0];
} while ($cursor ne '0');

my %summary = map {
  $_ => { count => 0, types => { map { $_ => 0 } @types },
    ttl => { map { $_ => 0 } @ttls } }
} @categories;
my %observed_types;
for my $key (keys %seen_keys) {
  fail() if time() >= $deadline;
  my $type = redis('TYPE', $key);
  my $ttl = redis('PTTL', $key);
  fail() unless defined $type && !ref($type) &&
    $type =~ /^[a-z][a-z0-9_-]{0,63}$/ &&
    defined $ttl && !ref($ttl) && $ttl =~ /^-?(?:0|[1-9][0-9]{0,15})$/;
  my $category = category($key);
  my $bucket = $ttl == -2 ? 'vanishedDuringScan' :
    $ttl == -1 ? 'persistent' :
    $ttl < 0 ? fail() :
    $ttl < 30000 ? 'under30Seconds' :
    $ttl < 600000 ? 'under10Minutes' : 'over10Minutes';
  $summary{$category}{ttl}{$bucket}++;
  next if $type eq 'none' && $ttl == -2;
  fail() if $type eq 'none' || $ttl == -2;
  fail() if $category =~ /^(?:medusaLocks|workflowCheckpointLocks|workflowCheckpoints|cartIdempotencyLocks|cartIdempotencyResults|healthSnapshots|rateLimits)$/ && $type ne 'string';
  $summary{$category}{count}++;
  $summary{$category}{types}{exists $summary{$category}{types}{$type} ? $type : 'other'}++;
  $observed_types{$key} = $type;
}
my %queues;
for my $queue (@queue_defs) {
  my ($name, $prefix) = @$queue;
  my %counts;
  for my $state (@states) {
    my ($suffix, $expected_type, $command) = @$state;
    my $key = "$prefix:$suffix";
    if (!exists $observed_types{$key}) { $counts{$suffix} = 0; next }
    fail() unless $observed_types{$key} eq $expected_type;
    my $count = redis($command, $key);
    fail() unless defined $count && !ref($count) &&
      $count =~ /^(?:0|[1-9][0-9]{0,9})$/ && $count <= 1_000_000_000;
    $counts{$suffix} = 0 + $count;
  }
  $queues{$name} = { keyCount => $summary{$name}{count}, states => \%counts };
}
my $after = source_state();
fail() unless $after->{runIdSha256} eq $before->{runIdSha256} &&
  $after->{db0Keys} == $before->{db0Keys} &&
  scalar(keys %seen_keys) == $before->{db0Keys};
print encode_json({ schemaVersion => 1, scannedKeys => scalar(keys %seen_keys),
  categories => \%summary, queues => \%queues }), "\n";
alarm(0);
