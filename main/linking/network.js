'use strict';

const os = require('os');

const VIRTUAL_INTERFACE_PATTERN =
    /(wsl|vethernet|hyper-v|virtualbox|vmware|docker|tailscale|zerotier|wireguard|hamachi|loopback|npcap|tap|tun|bridge|host-only|vpn|bluetooth|hotspot|mobile hotspot|shared)/i;
const WIFI_INTERFACE_PATTERN = /(wi-?fi|wireless|wlan|airport)/i;
const ETHERNET_INTERFACE_PATTERN = /(ethernet|local area connection|lan|^en\d|^eth\d)/i;
const CELLULAR_INTERFACE_PATTERN = /(cellular|wwan|mobile)/i;
const HOTSPOT_ADDRESS_PATTERN = /^192\.168\.137\./;

function isLinkLocalIpv4(address) {
    return /^169\.254\./.test(String(address || '').trim());
}

function isPrivateIpv4(address) {
    const value = String(address || '').trim();
    if (/^10\./.test(value) || /^192\.168\./.test(value)) {
        return true;
    }

    const match = /^172\.(\d{1,3})\./.exec(value);
    if (!match) {
        return false;
    }

    const secondOctet = Number(match[1]);
    return secondOctet >= 16 && secondOctet <= 31;
}

function detectInterfaceKind(interfaceName) {
    const name = String(interfaceName || '').trim();
    if (VIRTUAL_INTERFACE_PATTERN.test(name)) {
        return 'virtual';
    }
    if (WIFI_INTERFACE_PATTERN.test(name)) {
        return 'wifi';
    }
    if (ETHERNET_INTERFACE_PATTERN.test(name)) {
        return 'ethernet';
    }
    if (CELLULAR_INTERFACE_PATTERN.test(name)) {
        return 'cellular';
    }
    return 'other';
}

function scoreLanEndpoint(endpoint) {
    let score = 0;
    if (isPrivateIpv4(endpoint.address)) {
        score += 80;
    } else {
        score -= 25;
    }

    switch (endpoint.kind) {
        case 'wifi':
            score += 45;
            break;
        case 'ethernet':
            score += 40;
            break;
        case 'cellular':
            score += 12;
            break;
        case 'virtual':
            score -= 90;
            break;
        default:
            score += 8;
            break;
    }

    if (HOTSPOT_ADDRESS_PATTERN.test(endpoint.address)) {
        score -= 55;
    }

    if (!endpoint.netmask) {
        score -= 5;
    }

    return score;
}

function normalizeEndpoint(endpoint) {
    const normalized = {
        address: String(endpoint.address || '').trim(),
        interfaceName: String(endpoint.interfaceName || '').trim() || 'Unknown',
        netmask: String(endpoint.netmask || '').trim() || null,
        kind: endpoint.kind || detectInterfaceKind(endpoint.interfaceName),
        preferred: false
    };

    normalized.score = scoreLanEndpoint(normalized);
    return normalized;
}

function collectLanEndpoints(networkInterfaces = os.networkInterfaces()) {
    const endpoints = [];

    for (const [interfaceName, addresses] of Object.entries(networkInterfaces || {})) {
        if (!Array.isArray(addresses)) {
            continue;
        }

        for (const addr of addresses) {
            if (!addr || addr.family !== 'IPv4' || addr.internal) {
                continue;
            }

            const address = String(addr.address || '').trim();
            if (!address || isLinkLocalIpv4(address)) {
                continue;
            }

            endpoints.push(
                normalizeEndpoint({
                    address,
                    interfaceName,
                    netmask: addr.netmask || null
                })
            );
        }
    }

    endpoints.sort((left, right) => {
        if (right.score !== left.score) {
            return right.score - left.score;
        }
        if (left.interfaceName !== right.interfaceName) {
            return left.interfaceName.localeCompare(right.interfaceName);
        }
        return left.address.localeCompare(right.address);
    });

    return endpoints.map((endpoint, index) => ({
        address: endpoint.address,
        interfaceName: endpoint.interfaceName,
        netmask: endpoint.netmask,
        kind: endpoint.kind,
        preferred: index === 0
    }));
}

function getLanEndpoints() {
    return collectLanEndpoints();
}

function getPreferredLanEndpoint(networkInterfaces = os.networkInterfaces()) {
    return collectLanEndpoints(networkInterfaces)[0] || null;
}

function calculateBroadcastAddress(ip, netmask) {
    const ipParts = String(ip || '')
        .split('.')
        .map((part) => Number(part));
    const maskParts = String(netmask || '')
        .split('.')
        .map((part) => Number(part));

    if (ipParts.length !== 4 || maskParts.length !== 4 || ipParts.some(Number.isNaN) || maskParts.some(Number.isNaN)) {
        return null;
    }

    const broadcast = ipParts.map((octet, index) => octet | (~maskParts[index] & 0xff));
    return broadcast.join('.');
}

function getLanBroadcastAddresses(networkInterfaces = os.networkInterfaces()) {
    const broadcastSet = new Set();

    for (const endpoint of collectLanEndpoints(networkInterfaces)) {
        if (!endpoint.netmask) {
            continue;
        }

        const broadcastAddress = calculateBroadcastAddress(endpoint.address, endpoint.netmask);
        if (broadcastAddress) {
            broadcastSet.add(broadcastAddress);
        }
    }

    return broadcastSet.size > 0 ? Array.from(broadcastSet) : ['255.255.255.255'];
}

function getLanEndpointSummary(networkInterfaces = os.networkInterfaces()) {
    const lanEndpoints = collectLanEndpoints(networkInterfaces).map((endpoint) => ({
        address: endpoint.address,
        interfaceName: endpoint.interfaceName,
        preferred: endpoint.preferred
    }));
    const preferredLanIp = lanEndpoints.find((endpoint) => endpoint.preferred)?.address || null;

    return {
        preferredLanIp,
        lanEndpoints
    };
}

module.exports = {
    calculateBroadcastAddress,
    collectLanEndpoints,
    getLanBroadcastAddresses,
    getLanEndpoints,
    getLanEndpointSummary,
    getPreferredLanEndpoint,
    isLinkLocalIpv4,
    isPrivateIpv4
};
