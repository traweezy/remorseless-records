use strict; use warnings;
local $/; open my $original, '<', '/original-status' or die 'status missing'; my $status=<$original>;
my %updated;
for my $name ('libssl3t64','openssl-provider-legacy') {
 open my $control, '<', "/controls/$name/control" or die 'control missing'; my $data=<$control>;
 die 'package mismatch' unless $data =~ /^Package: \Q$name\E$/m;
 die 'version mismatch' unless $data =~ /^Version: 3\.5\.7-1~deb13u3$/m;
 die 'architecture mismatch' unless $data =~ /^Architecture: amd64$/m;
 $data =~ s/\n+$/\n/; $updated{$name}=$data."Status: install ok installed\n";
}
my %seen;
my @blocks=split /\n\n+/, $status;
for my $block (@blocks) {
 my ($name)=$block =~ /^Package: (.+)$/m;
 if(defined($name) && exists $updated{$name}) {
  die 'old version mismatch' unless $block =~ /^Version: 3\.5\.7-1~deb13u2$/m;
  die 'duplicate package' if $seen{$name}++;
  $block=$updated{$name}; $block =~ s/\n+$//;
 }
}
die 'missing old packages' unless scalar(keys %seen)==2;
open my $out, '>', '/overlay/var/lib/dpkg/status' or die 'output missing'; print $out join("\n\n",@blocks)."\n";
