use strict;
use warnings;
use bytes;
use Cwd qw(realpath);
use Digest::SHA qw(sha256_hex);
use Fcntl qw(O_RDONLY O_NOFOLLOW O_DIRECTORY);
use JSON::PP qw(decode_json encode_json);
use MIME::Base64 qw(encode_base64 decode_base64);
use POSIX qw(setsid);
use Time::HiRes qw(time);

$SIG{PIPE} = sub { die "pipe closed\n" };
my $request = decode_json(decode_base64($ARGV[0] // die "missing request\n"));
my $mode = $request->{mode} // die "missing mode\n";
die "invalid mode\n"
  unless $mode eq 'preflight' || $mode eq 'capture' || $mode eq 'postcheck';
die "missing password\n" unless defined $ENV{REDIS_PASSWORD} && length $ENV{REDIS_PASSWORD};

for my $pair (
  [projectId => 'RAILWAY_PROJECT_ID'],
  [environmentId => 'RAILWAY_ENVIRONMENT_ID'],
  [serviceId => 'RAILWAY_SERVICE_ID'],
  [deploymentId => 'RAILWAY_DEPLOYMENT_ID'],
  [instanceId => 'RAILWAY_REPLICA_ID'],
  [volumeId => 'RAILWAY_VOLUME_ID'],
  [mountPath => 'RAILWAY_VOLUME_MOUNT_PATH'],
) {
  die "source identity changed\n"
    unless defined $request->{$pair->[0]} &&
      ($ENV{$pair->[1]} // '') eq $request->{$pair->[0]};
}

my $cli = '/opt/bitnami/redis/bin/redis-cli';
die "Redis CLI unavailable\n" unless -x $cli;

sub redis_command {
  my (@args) = @_;
  local $ENV{REDISCLI_AUTH} = $ENV{REDIS_PASSWORD};
  my $pid = open(my $pipe, '-|');
  die "command unavailable\n" unless defined $pid;
  if ($pid == 0) {
    open STDERR, '>', '/dev/null' or exit 126;
    exec '/usr/bin/timeout', '-k', '2', '5', $cli,
      '-h', '127.0.0.1', '-p', '6379', '--raw', @args;
    exit 126;
  }
  my $output = '';
  while (1) {
    my $read = sysread($pipe, my $part, 4096);
    die "command read failed\n" unless defined $read;
    last if $read == 0;
    $output .= $part;
    die "command output too large\n" if length($output) > 65536;
  }
  close($pipe) or die "command failed\n";
  die "Redis command failed\n" if $output =~ /^(?:ERR|NOAUTH|NOPERM|WRONGPASS)\b/m;
  return $output;
}

sub config_value {
  my ($name) = @_;
  my $raw = redis_command('CONFIG', 'GET', $name);
  $raw =~ s/\r//g;
  my @lines = split /\n/, $raw;
  die "ambiguous Redis config\n" unless @lines == 2 && $lines[0] eq $name;
  return $lines[1];
}

sub info_values {
  my ($section) = @_;
  my $raw = redis_command('INFO', $section);
  my %values;
  for my $line (split /\n/, $raw) {
    $line =~ s/\r$//;
    next if $line eq '' || $line =~ /^#/;
    my ($key, $value) = split /:/, $line, 2;
    die "ambiguous Redis INFO\n" unless defined $value && !exists $values{$key};
    $values{$key} = $value;
  }
  return \%values;
}

sub source_state {
  my $server = info_values('server');
  my $persistence = info_values('persistence');
  my $replication = info_values('replication');
  die "unexpected Redis server\n"
    unless ($server->{redis_version} // '') eq '8.0.3' &&
      ($server->{run_id} // '') =~ /^[a-f0-9]{40}$/ &&
      ($replication->{role} // '') eq 'master' &&
      ($persistence->{aof_enabled} // '') eq '1' &&
      ($persistence->{aof_rewrite_in_progress} // '') eq '0' &&
      ($persistence->{aof_rewrite_scheduled} // '') eq '0' &&
      ($persistence->{aof_last_write_status} // '') eq 'ok' &&
      ($persistence->{aof_last_bgrewrite_status} // '') eq 'ok';
  die "unexpected Redis persistence\n"
    unless config_value('appendonly') eq 'yes' &&
      config_value('appendfsync') eq 'everysec' &&
      config_value('appendfilename') eq 'appendonly.aof' &&
      config_value('appenddirname') eq 'appendonlydir';
  my $data_dir = config_value('dir');
  my $mount = $request->{mountPath};
  die "unsafe Redis directory\n"
    unless $mount =~ m{^/[a-zA-Z0-9._/-]+$} &&
      $data_dir =~ m{^\Q$mount\E(?:/[a-zA-Z0-9._-]+)+$} &&
      realpath($data_dir) eq $data_dir;
  my $aof_dir = "$data_dir/appendonlydir";
  die "unsafe AOF directory\n" unless realpath($aof_dir) eq $aof_dir;
  my $path = '';
  for my $part (split '/', $aof_dir) {
    next unless length $part;
    $path .= "/$part";
    die "symlink in AOF path\n" if -l $path;
  }
  my $rewrite = config_value('auto-aof-rewrite-percentage');
  die "unsafe rewrite config\n" unless $rewrite =~ /^(?:0|[1-9][0-9]{0,4})$/;
  return {
    aofDir => $aof_dir,
    runIdSha256 => sha256_hex($server->{run_id}),
    autoRewritePercentage => $rewrite,
    aofCurrentSize => $persistence->{aof_current_size} // '',
  };
}

sub open_directory {
  my ($path) = @_;
  sysopen(my $directory, $path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    or die "AOF directory unavailable\n";
  return $directory;
}

sub open_regular {
  my ($directory, $name) = @_;
  die "unsafe AOF filename\n"
    unless $name =~ /^appendonly\.aof(?:\.manifest|\.[1-9][0-9]{0,9}\.(?:base\.(?:rdb|aof)|incr\.aof))$/;
  my $fd_path = '/proc/self/fd/' . fileno($directory) . '/' . $name;
  sysopen(my $file, $fd_path, O_RDONLY | O_NOFOLLOW)
    or die "AOF file unavailable\n";
  die "nonregular AOF file\n" unless -f $file;
  my @details = stat($file);
  die "AOF stat unavailable\n" unless @details;
  return ($file, \@details);
}

sub read_file {
  my ($directory, $name, $limit) = @_;
  my ($file, $details) = open_regular($directory, $name);
  die "AOF file too large\n" if $details->[7] > $limit;
  my $bytes = '';
  while (length($bytes) < $details->[7]) {
    my $read = sysread($file, my $part, $details->[7] - length($bytes));
    die "AOF file changed\n" unless defined $read && $read > 0;
    $bytes .= $part;
  }
  my @after = stat($file);
  die "AOF file changed\n"
    unless @after && $details->[0] == $after[0] &&
      $details->[1] == $after[1] && $details->[7] == $after[7] &&
      $details->[9] == $after[9] && $details->[10] == $after[10];
  close $file;
  return ($bytes, $details);
}

sub manifest_state {
  my ($directory) = @_;
  my ($manifest, $details) = read_file($directory, 'appendonly.aof.manifest', 16384);
  die "invalid manifest bytes\n" unless $manifest =~ /\n\z/ && $manifest !~ /[\r\0]/;
  my @names = ('appendonly.aof.manifest');
  for my $line (split /\n/, $manifest) {
    next if $line =~ /^#/;
    die "invalid manifest entry\n"
      unless $line =~ /^file (appendonly\.aof\.[1-9][0-9]{0,9}\.(?:base\.(?:rdb|aof)|incr\.aof)) seq [1-9][0-9]{0,9} type [bhi](?: startoffset (?:0|[1-9][0-9]{0,15})(?: endoffset (?:0|[1-9][0-9]{0,15}))?)?$/;
    push @names, $1;
  }
  die "too many AOF files\n" unless @names >= 2 && @names <= 33;
  opendir(my $listing, '/proc/self/fd/' . fileno($directory))
    or die "AOF listing unavailable\n";
  my @actual = sort grep { $_ ne '.' && $_ ne '..' } readdir($listing);
  closedir($listing);
  die "AOF files changed\n" unless join('\0', @actual) eq join('\0', sort @names);
  return ($manifest, $details, \@names);
}

sub emit {
  my ($value) = @_;
  print encode_json($value), "\n" or die "capture output closed\n";
}

if ($mode eq 'postcheck') {
  my $server = info_values('server');
  die "source restarted\n"
    unless sha256_hex($server->{run_id} // '') eq
      ($request->{runIdSha256} // '');
  my $rewrite = config_value('auto-aof-rewrite-percentage');
  die "rewrite setting not restored\n"
    unless $rewrite eq ($request->{priorRewritePercentage} // '');
  emit({ type => 'postcheck', runIdSha256 => sha256_hex($server->{run_id}),
    autoRewritePercentage => $rewrite });
  exit 0;
}

my $before = source_state();
my $directory = open_directory($before->{aofDir});
my ($manifest, $manifest_details, $names) = manifest_state($directory);
my $manifest_hash = sha256_hex($manifest);
if ($mode eq 'preflight') {
  my $total = 0;
  my @files;
  for my $name (@$names) {
    my ($file, $details) = open_regular($directory, $name);
    close $file;
    $total += $details->[7];
    die "AOF budget exceeded\n" if $total > $request->{maxBytes};
    push @files, { name => $name, bytes => $details->[7] };
  }
  emit({ type => 'preflight', %$before,
    manifestBase64 => encode_base64($manifest, ''),
    manifestSha256 => $manifest_hash, files => \@files, totalBytes => $total });
  exit 0;
}

die "source changed since preflight\n"
  unless $manifest_hash eq ($request->{manifestSha256} // '') &&
    $before->{runIdSha256} eq ($request->{runIdSha256} // '') &&
    $before->{autoRewritePercentage} eq ($request->{priorRewritePercentage} // '');
die "unexpected file set\n"
  unless join('\0', @$names) eq join('\0', @{$request->{files} // []});

my $prior = $before->{autoRewritePercentage};
my $deadline = time() + $request->{deadlineSeconds};
pipe(my $watch_read, my $watch_write) or die "watchdog unavailable\n";
pipe(my $ready_read, my $ready_write) or die "watchdog unavailable\n";
my $watchdog = fork();
die "watchdog unavailable\n" unless defined $watchdog;
if ($watchdog == 0) {
  close $watch_write;
  close $ready_read;
  exit 1 unless setsid() > 0;
  open STDIN, '<', '/dev/null';
  open STDOUT, '>', '/dev/null';
  open STDERR, '>', '/dev/null';
  syswrite($ready_write, 'R') == 1 or exit 1;
  close $ready_write;
  my $remaining = $deadline - time();
  my $ready = '';
  if ($remaining > 0) {
    my $bits = '';
    vec($bits, fileno($watch_read), 1) = 1;
    my $selected = select($bits, undef, undef, $remaining);
    sysread($watch_read, $ready, 1) if $selected;
  }
  my $ok = eval {
    for (1..3) {
      my $attempt = eval {
        if (config_value('auto-aof-rewrite-percentage') eq $prior) {
          1;
        } else {
          redis_command('CONFIG', 'SET', 'auto-aof-rewrite-percentage', $prior);
          config_value('auto-aof-rewrite-percentage') eq $prior;
        }
      };
      last if $attempt;
      select(undef, undef, undef, 0.2);
    }
    config_value('auto-aof-rewrite-percentage') eq $prior or die "restore failed\n";
    1;
  };
  exit($ok ? 0 : 1);
}
close $watch_read;
close $ready_write;
my $ready_bits = '';
vec($ready_bits, fileno($ready_read), 1) = 1;
my $ready_selected = select($ready_bits, undef, undef, 5);
my $ready_value = '';
sysread($ready_read, $ready_value, 1) if $ready_selected;
close $ready_read;
if ($ready_value ne 'R') {
  close $watch_write;
  waitpid($watchdog, 0);
  die "watchdog unavailable\n";
}
my $capture_ok = eval {
  local $SIG{TERM} = sub { die "capture terminated\n" };
  local $SIG{INT} = sub { die "capture interrupted\n" };
  local $SIG{HUP} = sub { die "capture disconnected\n" };
  die "rewrite hold expired\n" if time() >= $deadline;
  redis_command('CONFIG', 'SET', 'auto-aof-rewrite-percentage', '0');
  die "rewrite hold failed\n" unless config_value('auto-aof-rewrite-percentage') eq '0';
  my $held = source_state();
  die "source changed during hold\n"
    unless $held->{runIdSha256} eq $before->{runIdSha256} &&
      $held->{autoRewritePercentage} eq '0';
  emit({ type => 'start', manifestSha256 => $manifest_hash,
    runIdSha256 => $before->{runIdSha256}, priorRewritePercentage => $prior });
  my $total = 0;
  for my $name (@$names) {
    die "capture deadline\n" if time() >= $deadline;
    my ($file, $details) = open_regular($directory, $name);
    my $size = $details->[7];
    die "AOF budget exceeded\n" if $size < 0 || $total + $size > $request->{maxBytes};
    emit({ type => 'fileStart', name => $name, bytes => $size });
    my $hash = Digest::SHA->new(256);
    my $offset = 0;
    while ($offset < $size) {
      die "capture deadline\n" if time() >= $deadline;
      my $length = $size - $offset;
      $length = 32768 if $length > 32768;
      my $read = sysread($file, my $part, $length);
      die "AOF file shortened\n" unless defined $read && $read > 0;
      $hash->add($part);
      emit({ type => 'chunk', name => $name, offset => $offset,
        data => encode_base64($part, '') });
      $offset += $read;
    }
    my @after = stat($file);
    die "AOF file replaced\n"
      unless @after && $details->[0] == $after[0] &&
        $details->[1] == $after[1] && $after[7] >= $size;
    if ($name !~ /\.incr\.aof$/) {
      die "immutable AOF file changed\n"
        unless $after[7] == $size && $details->[9] == $after[9] &&
          $details->[10] == $after[10];
    }
    my $digest = $hash->hexdigest;
    if ($name =~ /\.incr\.aof$/) {
      sysseek($file, 0, 0) == 0 or die "AOF prefix unavailable\n";
      my $prefix_hash = Digest::SHA->new(256);
      my $verified = 0;
      while ($verified < $size) {
        die "capture deadline\n" if time() >= $deadline;
        my $length = $size - $verified;
        $length = 32768 if $length > 32768;
        my $read = sysread($file, my $part, $length);
        die "AOF prefix changed\n" unless defined $read && $read > 0;
        $prefix_hash->add($part);
        $verified += $read;
      }
      die "AOF prefix changed\n" unless $prefix_hash->hexdigest eq $digest;
    }
    close $file;
    $total += $size;
    emit({ type => 'fileEnd', name => $name, bytes => $size,
      sha256 => $digest });
  }
  my ($manifest_after, $manifest_after_details, $names_after) = manifest_state($directory);
  my $after = source_state();
  die "AOF rewrite drift\n"
    unless sha256_hex($manifest_after) eq $manifest_hash &&
      $manifest_details->[0] == $manifest_after_details->[0] &&
      $manifest_details->[1] == $manifest_after_details->[1] &&
      join('\0', @$names_after) eq join('\0', @$names) &&
      $after->{runIdSha256} eq $before->{runIdSha256} &&
      $after->{autoRewritePercentage} eq '0';
  die "manifest copy changed\n" unless $request->{manifestSha256} eq $manifest_hash;
  1;
};
my $restore_ok = eval {
  redis_command('CONFIG', 'SET', 'auto-aof-rewrite-percentage', $prior);
  config_value('auto-aof-rewrite-percentage') eq $prior
    or die "rewrite setting not restored\n";
  1;
};
if ($restore_ok) {
  syswrite($watch_write, 'D');
}
close $watch_write;
waitpid($watchdog, 0);
my $watchdog_ok = $? == 0;
if ($capture_ok && $restore_ok && $watchdog_ok) {
  emit({ type => 'done', manifestSha256 => $manifest_hash,
    runIdSha256 => $before->{runIdSha256}, priorRewritePercentage => $prior,
    rewriteRestored => JSON::PP::true });
  exit 0;
}
emit({ type => 'failed', rewriteRestored => ($restore_ok && $watchdog_ok)
  ? JSON::PP::true : JSON::PP::false });
exit 1;
