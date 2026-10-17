#!/bin/sh
set -eu
export XTABLES_LOCKFILE=/tmp/xtables.lock
# Fail closed if the network boundary cannot be installed. This namespace has
# no connection to Volna's application/DB networks, only public egress + Unix IPC.
iptables -P OUTPUT DROP
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -d 127.0.0.11 -p udp -j ACCEPT
iptables -A OUTPUT -d 127.0.0.11 -p tcp -j ACCEPT
for range in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/3; do
 iptables -A OUTPUT -d "$range" -j REJECT
done
iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT
ip6tables -P OUTPUT DROP
ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for range in 2001::/23 2001:db8::/32 2002::/16 3ffe::/16 3fff::/20; do
 ip6tables -A OUTPUT -d "$range" -j REJECT
done
ip6tables -A OUTPUT -d 2000::/3 -p tcp --dport 443 -j ACCEPT
mkdir -p /run/volna-webhook
chown node:node /run/volna-webhook
chmod 770 /run/volna-webhook
exec setpriv --reuid=node --regid=node --init-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all node server/webhook-egress.mjs
