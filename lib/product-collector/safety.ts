/**
 * Links the collector must never fetch: anything that is not http(s), and
 * local, private-network or cloud-metadata addresses (so the server cannot be
 * used to reach internal services). Based on the for_amina route's check.
 */
export function isCollectableUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  if (url.username || url.password) return false

  const host = url.hostname.toLowerCase()
  return !(
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    /^0\./.test(host) ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) || // link-local, includes cloud metadata 169.254.169.254
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) || // carrier-grade NAT
    host.startsWith("[") || // any IPv6 literal
    /^\d+$/.test(host) // decimal-encoded IPv4 such as http://2130706433/
  )
}
