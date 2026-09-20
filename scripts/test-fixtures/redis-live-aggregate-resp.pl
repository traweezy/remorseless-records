use strict;
use warnings;
use bytes;
use Digest::SHA qw(sha256_hex);
use IO::Socket::INET;
use JSON::PP qw(encode_json);
use MIME::Base64 qw(encode_base64);

alarm(15);
my $mode = $ENV{RR_TEST_MODE} // die "missing fixture mode\n";
my $run_id = 'a' x 40;
my %scope = (
  projectId => '11111111-1111-4111-8111-111111111111',
  environmentId => '22222222-2222-4222-8222-222222222222',
  serviceId => '33333333-3333-4333-8333-333333333333',
  deploymentId => '44444444-4444-4444-8444-444444444444',
  instanceId => '55555555-5555-4555-8555-555555555555',
  volumeId => '66666666-6666-4666-8666-666666666666',
  volumeInstanceId => '77777777-7777-4777-8777-777777777777',
  mountPath => '/bitnami',
);
$ENV{RAILWAY_PROJECT_ID} = $scope{projectId};
$ENV{RAILWAY_ENVIRONMENT_ID} = $scope{environmentId};
$ENV{RAILWAY_SERVICE_ID} = $scope{serviceId};
$ENV{RAILWAY_DEPLOYMENT_ID} = $scope{deploymentId};
$ENV{RAILWAY_REPLICA_ID} = $scope{instanceId};
$ENV{RAILWAY_VOLUME_ID} = $scope{volumeId};
$ENV{RAILWAY_VOLUME_MOUNT_PATH} = $scope{mountPath};
$ENV{REDIS_PASSWORD} = 'fixture-only-password';
my $request = encode_base64(encode_json({
  %scope, mode => 'aggregate', runIdSha256 => sha256_hex($run_id),
}), '');
mkdir '/bitnami/redis' or die "fixture directory unavailable\n";
mkdir '/bitnami/redis/data' or die "fixture directory unavailable\n";
mkdir '/bitnami/redis/data/appendonlydir' or die "fixture directory unavailable\n";

my $server = IO::Socket::INET->new(
  LocalAddr => '127.0.0.1', LocalPort => 6379, Listen => 1,
  ReuseAddr => 1, Proto => 'tcp',
) or die "fixture socket unavailable\n";
pipe(my $output_read, my $output_write) or die "fixture pipe unavailable\n";
my $child = fork();
die "fixture fork unavailable\n" unless defined $child;
if ($child == 0) {
  close $output_read;
  close $server;
  open STDOUT, '>&', $output_write or exit 126;
  open STDERR, '>', '/dev/null' or exit 126;
  close $output_write;
  exec 'perl', '/repo/scripts/lib/redis-live-aggregate-remote.pl', $request;
  exit 126;
}
close $output_write;
my $connection = $server->accept() or die "fixture connect unavailable\n";
$connection->autoflush(1);
my @commands;
my $server_reads = 0;
my $keyspace_reads = 0;
my @keys = (
  'bull:medusa-workflows-jobs:failed',
  'RedisEventBusService:events-queue:failed',
  'rr:health:secret-order-123',
  'private:user-456',
);
sub line {
  my $value = '';
  while (1) {
    my $read = sysread($connection, my $part, 1);
    return undef unless defined $read && $read > 0;
    $value .= $part;
    die "fixture line overflow\n" if length($value) > 1024;
    return substr($value, 0, -2) if $value =~ /\r\n\z/;
  }
}
sub exact {
  my ($length) = @_;
  my $value = '';
  while (length($value) < $length) {
    my $read = sysread($connection, my $part, $length - length($value));
    die "fixture short command\n" unless defined $read && $read > 0;
    $value .= $part;
  }
  return $value;
}
sub bulk {
  my ($value) = @_;
  return '$' . length($value) . "\r\n$value\r\n";
}
sub array {
  my (@values) = @_;
  return '*' . scalar(@values) . "\r\n" . join('', map { bulk($_) } @values);
}
sub response {
  my (@parts) = @_;
  my ($command, @args) = @parts;
  push @commands, $command;
  return "+OK\r\n" if $command eq 'AUTH';
  if ($command eq 'INFO') {
    my $observed_run_id =
      ($args[0] eq 'server' && $mode eq 'runDrift' && ++$server_reads > 1)
        ? ('b' x 40) : $run_id;
    my $observed_db0_keys =
      ($args[0] eq 'keyspace' && $mode eq 'countDrift' && ++$keyspace_reads > 1)
        ? 5 : 4;
    my %values = (
      server => 'redis_version:8.0.3' . "\r\nrun_id:" .
        $observed_run_id . "\r\n",
      persistence => join("\r\n", qw(
        aof_enabled:1 aof_rewrite_in_progress:0 aof_rewrite_scheduled:0
        aof_last_write_status:ok aof_last_bgrewrite_status:ok
      )) . "\r\n",
      replication => "role:master\r\n",
      keyspace => $mode eq 'empty' ? '' : 'db0:keys=' .
        $observed_db0_keys .
        ",expires=1,avg_ttl=660000,subexpiry=0\r\n" .
        ($mode eq 'otherDb' ? "db1:keys=1,expires=0,avg_ttl=0\r\n" : ''),
    );
    return exists $values{$args[0]} ? bulk($values{$args[0]}) : "-ERR info\r\n";
  }
  if ($command eq 'DBSIZE') {
    return ':' . ($mode eq 'empty' ? 0 :
      (($mode eq 'countDrift' && $keyspace_reads > 1) ? 5 : 4)) . "\r\n";
  }
  if ($command eq 'CONFIG') {
    my %values = (
      appendonly => 'yes', appendfsync => 'everysec',
      appendfilename => 'appendonly.aof', appenddirname => 'appendonlydir',
      dir => '/bitnami/redis/data',
    );
    return $args[0] eq 'GET' && exists $values{$args[1]}
      ? array($args[1], $values{$args[1]}) : "-ERR config\r\n";
  }
  if ($command eq 'SCAN') {
    return "-ERR scan\r\n" unless join('|', @args) eq '0|COUNT|128';
    return "*2\r\n" . bulk('0') .
      array($mode eq 'oversize' ? (map { 'x' } 1 .. 513) :
        $mode eq 'empty' ? () :
        $mode eq 'replacementKey' ? (@keys[0 .. 2], "private:\xEF\xBF\xBD") : @keys);
  }
  if ($command eq 'TYPE') {
    return bulk($args[0] =~ /:failed$/ && $mode ne 'wrongType' ? 'zset' : 'string');
  }
  if ($command eq 'PTTL') {
    return ':' . ($args[0] =~ /^rr:health:/ ? 660000 : -1) . "\r\n";
  }
  if ($command eq 'ZCARD') {
    return ':' . ($args[0] =~ /^bull:/ ? 237 : 1) . "\r\n";
  }
  return "-ERR forbidden\r\n";
}
while (defined(my $header = line())) {
  die "fixture invalid command\n" unless $header =~ /^\*([1-4])$/;
  my $count = $1;
  my @parts;
  for (1 .. $count) {
    my $length = line();
    die "fixture invalid bulk\n" unless defined $length && $length =~ /^\$([0-9]{1,4})$/;
    my $bytes = exact($1 + 2);
    die "fixture invalid terminator\n" unless $bytes =~ /\r\n\z/;
    push @parts, substr($bytes, 0, -2);
  }
  print $connection response(@parts) or die "fixture reply failed\n";
}
close $connection;
close $server;
my $output = '';
while (1) {
  my $read = sysread($output_read, my $part, 4096);
  die "fixture output unavailable\n" unless defined $read;
  last if $read == 0;
  $output .= $part;
  die "fixture output overflow\n" if length($output) > 16384;
}
close $output_read;
waitpid($child, 0);
print encode_json({ exitCode => $? >> 8, output => $output, commands => \@commands }), "\n";
