import assert from "node:assert/strict";
import test from "node:test";
import {
  isLikelyVirtualNetworkInterface,
  selectLanAccessAddresses
} from "../src/network-access.js";

test("recognizes proxy, VPN, container, and tunnel interfaces", () => {
  for (const name of ["tun0", "utun4", "Tailscale0", "docker0", "br-123abc", "veth9", "vEthernet (WSL)", "mihomo0"]) {
    assert.equal(isLikelyVirtualNetworkInterface(name), true, name);
  }
  for (const name of ["wlan0", "en0", "eth0", "Ethernet"]) {
    assert.equal(isLikelyVirtualNetworkInterface(name), false, name);
  }
});

test("shows physical LAN addresses instead of local proxy tunnel addresses", () => {
  assert.deepEqual(selectLanAccessAddresses({
    lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    tun0: [{ family: "IPv4", address: "172.19.0.1", internal: false }],
    docker0: [{ family: "IPv4", address: "172.17.0.1", internal: false }],
    wlan0: [{ family: "IPv4", address: "192.168.1.4", internal: false }]
  }), ["192.168.1.4"]);
});

test("orders common private physical networks and ignores invalid addresses", () => {
  assert.deepEqual(selectLanAccessAddresses({
    eth1: [
      { family: 4, address: "10.0.0.8", internal: false },
      { family: "IPv6", address: "2001:db8::1", internal: false }
    ],
    wlan0: [
      { family: "IPv4", address: "192.168.50.9", internal: false },
      { family: "IPv4", address: "not-an-ip", internal: false }
    ],
    tun3: [{ family: "IPv4", address: "192.168.99.1", internal: false }]
  }), ["192.168.50.9", "10.0.0.8"]);
});

test("returns no misleading address when only virtual interfaces exist", () => {
  assert.deepEqual(selectLanAccessAddresses({
    tun0: [{ family: "IPv4", address: "172.19.0.1", internal: false }]
  }), []);
});
