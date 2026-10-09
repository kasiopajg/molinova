import type { Rule } from "../config.js";
import type { Item } from "../connectors/types.js";
import { domainOf } from "./text.js";

/** Première règle qui correspond, dans l'ordre du fichier. */
export function matchRule(item: Item, rules: Rule[]): Rule | undefined {
  const domain = domainOf(item.fromAddress);
  const subject = item.subject.toLowerCase();
  return rules.find((r) => {
    const w = r.when;
    if (w.fromDomain && !(domain === w.fromDomain.toLowerCase() || domain.endsWith("." + w.fromDomain.toLowerCase()))) return false;
    if (w.fromAddress && item.fromAddress !== w.fromAddress.toLowerCase()) return false;
    if (w.subjectContains && !w.subjectContains.some((s) => subject.includes(s.toLowerCase()))) return false;
    if (w.hasListUnsubscribe !== undefined && item.hasListUnsubscribe !== w.hasListUnsubscribe) return false;
    return true;
  });
}
