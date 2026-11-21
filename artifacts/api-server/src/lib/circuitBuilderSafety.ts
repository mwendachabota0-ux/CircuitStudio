const CHARGER_REQUEST = /\b(?:charger|charging)\b/i;
const PHONE_OR_USB_CONTEXT = /\b(?:phone|mobile|smartphone|usb|device)\b/i;
const HIGH_VOLTAGE_SOURCE =
  /\b(?:mains|line voltage|wall (?:outlet|socket)|household (?:mains|electricity|power)|(?:110|115|120|127|220|230|240)\s*(?:-|–|to)\s*(?:110|115|120|127|220|230|240)\s*(?:v|volts?)?\s*(?:ac|alternating current)?|(?:110|115|120|127|220|230|240)\s*(?:v|volts?)\s*(?:ac|alternating current))\b/i;
const LOW_VOLTAGE_ONLY =
  /\bonly\b.{0,35}\b(?:low[-\s]?voltage|5\s*v|secondary|output side)\b|\b(?:low[-\s]?voltage|secondary|output side)\b.{0,35}\b(?:only|exclude|without|do not include)\b/i;

export function isMainsChargerBuildRequest(message: string): boolean {
  const text = message.normalize("NFKC");
  if (LOW_VOLTAGE_ONLY.test(text)) return false;
  return CHARGER_REQUEST.test(text) &&
    PHONE_OR_USB_CONTEXT.test(text) &&
    HIGH_VOLTAGE_SOURCE.test(text);
}
