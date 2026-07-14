const virtualInterfacePatterns = [
  /^(?:lo|tun|tap|utun|wg|tailscale|zerotier|zt|docker|veth|virbr|vmnet|vboxnet|dummy|ifb|ppp)\d*/i,
  /^(?:br[-_]|sipa_|vowifi|clash|mihomo|sing[-_]?box|vpn)/i,
  /(?:^|[\s_-])(?:wsl|hyper-v|virtual|tunnel|proxy|vpn)(?:$|[\s_()-])/i
];

export function isLikelyVirtualNetworkInterface(name) {
  const value = String(name || "").trim();
  return !value || virtualInterfacePatterns.some((pattern) => pattern.test(value));
}

function normalizeIpv4Entry(entry) {
  if (!entry || entry.internal) return null;
  if (entry.family !== "IPv4" && entry.family !== 4) return null;
  const address = String(entry.address || "").trim();
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  if (octets[0] === 0 || octets[0] === 127 || octets.every((octet) => octet === 255)) return null;
  return { address, octets };
}

function addressPriority(octets) {
  if (octets[0] === 192 && octets[1] === 168) return 0;
  if (octets[0] === 10) return 1;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return 2;
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return 3;
  if (octets[0] === 169 && octets[1] === 254) return 9;
  return 4;
}

function interfacePriority(name) {
  const value = String(name || "").toLowerCase();
  if (/^(?:wl|wlan|wifi|wi-fi)/.test(value)) return 0;
  if (/^(?:en\d|eth|eno|ens|enp)|ethernet/.test(value)) return 1;
  return 2;
}

export function selectLanAccessAddresses(interfaces = {}) {
  const candidates = [];
  for (const [name, entries] of Object.entries(interfaces || {})) {
    if (isLikelyVirtualNetworkInterface(name)) continue;
    for (const entry of entries || []) {
      const normalized = normalizeIpv4Entry(entry);
      if (!normalized) continue;
      candidates.push({
        address: normalized.address,
        addressPriority: addressPriority(normalized.octets),
        interfacePriority: interfacePriority(name)
      });
    }
  }

  const seen = new Set();
  return candidates
    .sort((left, right) => left.addressPriority - right.addressPriority
      || left.interfacePriority - right.interfacePriority
      || left.address.localeCompare(right.address, undefined, { numeric: true }))
    .map((candidate) => candidate.address)
    .filter((address) => {
      if (seen.has(address)) return false;
      seen.add(address);
      return true;
    });
}
