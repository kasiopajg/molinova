// Comparaison de versions « semver » simple (x.y.z, préversion -beta.1 plus ancienne que la version finale).

function parse(v: string): { nums: number[]; pre: string } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? "" } : null;
}

/** a > b ? Une version illisible n'est jamais « plus récente ». */
export function isNewerVersion(a: string, b: string): boolean {
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i];
  if (x.pre === y.pre) return false;
  if (!x.pre) return true; // 1.0.0 > 1.0.0-beta
  if (!y.pre) return false;
  const xs = x.pre.split("."), ys = y.pre.split(".");
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    if (xs[i] === undefined) return false;
    if (ys[i] === undefined) return true;
    const xn = /^\d+$/.test(xs[i]) ? Number(xs[i]) : NaN, yn = /^\d+$/.test(ys[i]) ? Number(ys[i]) : NaN;
    if (xs[i] === ys[i]) continue;
    if (!Number.isNaN(xn) && !Number.isNaN(yn)) return xn > yn;
    if (!Number.isNaN(xn)) return false; // numérique < alphanumérique
    if (!Number.isNaN(yn)) return true;
    return xs[i] > ys[i];
  }
  return false;
}
