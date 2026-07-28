/**
 * ocean verify <id> — insan onayı akışı. "Çalışıyor"nun tek meşru kapısı.
 *
 * <id> ya tek bir CLAIM ya da bir İŞ BİRİMİ (pasaport maddesi, `birim-…`)
 * olabilir. Birim verilirse birimdeki TÜM doğrulanmamış kayıtlar ekrana
 * dökülür ve TEK soruyla birlikte onaylanır — 278 kere "evet" demek zorunda
 * kalmadan FULL-TİK'e erişilebilsin diye. Kör onay yok: onaylanan her kayıt
 * (iddia + kanıtları) soru sorulmadan ÖNCE gösterilir.
 *
 * Akış: claim'leri göster → kanıtları listele → kullanıcı onayı sor (e/H) →
 * onaylanırsa:
 *   - claim insan-onayi seviyesine yükselir (approveClaim — verify akışının
 *     TEK yükseltme kapısı; motor asla kendisi yükseltmez),
 *   - pasaport maddesi completed + verification olur,
 *   - .ocean/passport.jsonl'e APPEND edilir (değişmez onay logu),
 *   - kart yeniden kurulur, state + pano yazılır,
 *   - pasaport FULL-TİK olduysa BİR KEZ macOS bildirimi:
 *     "Ocean: ürün geliştirildi 🎉" (fullTickNotifiedAt ile tekrarlanmaz).
 *
 * Reddedilirse (H) hiçbir seviye değişmez — dürüstlük: onay zorla alınmaz.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import {
  EVIDENCE_LEVEL_LABELS_TR,
  SCHEMA_VERSION,
  isPassportFull,
  type Claim,
  type ClaimEvidence,
  type OceanState,
  type PassportItem,
  type Verification,
} from './types.ts';
import { buildCard, scriptsFromPackageJson } from './card.ts';
import { buildPassport, claimTitle } from './passport.ts';
import { renderPano } from './pano.ts';
import { notifyMac } from './notify.ts';
import {
  appendPassportLog,
  panoPath,
  readGoal,
  readState,
  writePano,
  writeState,
} from './state.ts';

/**
 * İnsan onayıyla claim yükseltme — verify akışının TEK kapısı.
 * (truth.ts buildCalisiyorClaim ile birlikte 'insan-onayi'nin iki meşru
 * üretim yolundan biri; ikisi de Verification olmadan çağrılamaz.)
 */
export function approveClaim(claim: Claim, verification: Verification): Claim {
  const humanEvidence: ClaimEvidence = {
    kind: 'human',
    summary: `${verification.by} ${verification.at} tarihinde doğruladı${
      verification.note !== undefined ? `: ${verification.note}` : '.'
    }`,
  };
  return { ...claim, level: 'insan-onayi', evidence: [...claim.evidence, humanEvidence] };
}

export interface VerifyDeps {
  /** Soru sor, cevabı al (CLI: readline; test: sahte). */
  ask: (question: string) => Promise<string>;
  /** Satır yaz (CLI: stdout; test: toplayıcı). */
  out: (line: string) => void;
  /** Bildirim (varsayılan notifyMac — hata yutar). */
  notify?: (title: string, message: string) => Promise<boolean>;
  /** Onaylayan kişi (varsayılan: işletim sistemi kullanıcı adı). */
  by?: string;
  now?: Date;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
  approved?: boolean;
  fullTick?: boolean;
  notified?: boolean;
  panoPath?: string;
}

const YES = new Set(['e', 'evet', 'y', 'yes']);

function evidenceLines(claim: Claim): string[] {
  if (claim.evidence.length === 0) return ['  (kanıt kaydı yok)'];
  return claim.evidence.map((e) => `  - [${e.kind}] ${e.summary}`);
}

export async function runVerify(cwd: string, id: string, deps: VerifyDeps): Promise<VerifyResult> {
  const now = deps.now ?? new Date();
  const notify = deps.notify ?? notifyMac;

  const state = await readState(cwd);
  if (state === null) {
    return { ok: false, error: "Bu proje Ocean'a bağlı değil. Önce: ocean init" };
  }

  // ── hedefi çöz: tek claim mi, iş birimi mi? ──
  const byIdx = new Map<string, number>(state.claims.map((c, i) => [c.id, i]));
  const unit = state.passport.find((p) => p.id === id);
  let hedefIdx: number[];
  let hedefAdi: string;
  if (byIdx.has(id)) {
    hedefIdx = [byIdx.get(id) as number];
    hedefAdi = id;
  } else if (unit !== undefined) {
    hedefIdx = unit.claimIds.map((cid) => byIdx.get(cid)).filter((i): i is number => i !== undefined);
    hedefAdi = unit.title;
  } else {
    hedefIdx = [];
    hedefAdi = id;
  }

  if (hedefIdx.length === 0) {
    const birimler = state.passport.slice(-3).map((p) => `  - ${p.id}  (${p.claimIds.length} kayıt)`);
    const known = state.claims.slice(-5).map((c) => `  - ${c.id}`);
    return {
      ok: false,
      error:
        `Kayıt bulunamadı: ${id}\n` +
        (known.length > 0
          ? `Kayıtlı son claim id'leri:\n${known.join('\n')}` +
            (birimler.length > 0 ? `\nPasaport iş birimleri (hepsini tek onayla):\n${birimler.join('\n')}` : '')
          : "Henüz hiç claim yok — önce: ocean sync"),
    };
  }

  // ── göster: her iddia + seviye + kanıtlar (karar insanın, kör onay yok) ──
  const hedefler = hedefIdx.map((i) => state.claims[i] as Claim);
  if (unit !== undefined && hedefler.length > 1) {
    deps.out('');
    deps.out(`İş birimi: ${hedefAdi}`);
    deps.out(`Kayıt    : ${hedefler.length} adet — hepsi aşağıda`);
  }
  for (const c of hedefler) {
    deps.out('');
    deps.out(`İddia   : ${c.text}`);
    deps.out(`Seviye  : ${EVIDENCE_LEVEL_LABELS_TR[c.level]}`);
    deps.out('Kanıtlar:');
    for (const line of evidenceLines(c)) deps.out(line);
  }
  deps.out('');

  const bekleyenIdx = hedefIdx.filter((i) => (state.claims[i] as Claim).level !== 'insan-onayi');
  if (bekleyenIdx.length === 0) {
    deps.out(
      hedefler.length > 1
        ? 'Bu birimdeki tüm kayıtlar zaten insan onaylı — yeniden onay gerekmiyor.'
        : 'Bu iddia zaten insan onaylı — yeniden onay gerekmiyor.',
    );
    return { ok: true, approved: false };
  }

  const soru =
    bekleyenIdx.length > 1
      ? `Bu ${bekleyenIdx.length} kaydın hepsini kendi gözünle doğruladın mı? [e/H] `
      : 'Bu işi kendi gözünle doğruladın mı? [e/H] ';
  const answer = (await deps.ask(soru)).trim().toLowerCase();
  if (!YES.has(answer)) {
    deps.out('Onay kaydedilmedi — seviye değişmedi. (Doğrulamadan onay yok: dürüstlük böyle çalışır.)');
    return { ok: true, approved: false };
  }

  // ── onay: tek yönlü yükseltme + değişmez log ──
  const by = deps.by ?? userInfo().username;
  const verification: Verification = { by, at: now.toISOString(), decision: 'approved' };
  const claims = [...state.claims];
  const onaylananlar: Claim[] = [];
  for (const i of bekleyenIdx) {
    const c = state.claims[i] as Claim;
    claims[i] = approveClaim(c, verification);
    onaylananlar.push(c);
  }

  const title = claimTitle(hedefler.length > 1 ? hedefAdi : (hedefler[0] as Claim).text);
  // passport.jsonl KAYIT BAŞINA satır: değişmez log tek tek izlenebilir kalır.
  for (const c of onaylananlar) {
    await appendPassportLog(cwd, {
      schema_version: SCHEMA_VERSION,
      at: verification.at,
      claimId: c.id,
      title: claimTitle(c.text),
      decision: verification.decision,
      by,
      levelBefore: c.level,
      levelAfter: 'insan-onayi',
    });
  }

  // Pasaport iş birimleri claim'lerden yeniden kurulur; bu onay ilgili birime yazılır.
  const onayliIds = new Set(claims.filter((c) => c.level === 'insan-onayi').map((c) => c.id));
  const onaylananIds = new Set(onaylananlar.map((c) => c.id));
  const passport: PassportItem[] = buildPassport(state.passport, claims).map((p) =>
    p.verification === undefined &&
    p.claimIds.some((cid) => onaylananIds.has(cid)) &&
    p.claimIds.every((cid) => onayliIds.has(cid))
      ? { ...p, verification }
      : p,
  );

  const log = [
    ...state.log,
    {
      ts: verification.at,
      text:
        onaylananlar.length > 1
          ? `Doğrulandı: ${title} — ${onaylananlar.length} kayıt (${by})`
          : `Doğrulandı: ${title} (${by})`,
      source: 'insan' as const,
    },
  ];

  // ── full-tik kontrolü (bildirim BİR KEZ) ──
  const fullTick = isPassportFull(passport);
  let notified = false;
  let fullTickNotifiedAt = state.fullTickNotifiedAt;
  if (fullTick && fullTickNotifiedAt === undefined) {
    notified = await notify('Ocean', 'Ürün geliştirildi 🎉 — pasaporttaki tüm maddeler insan onaylı.');
    fullTickNotifiedAt = verification.at;
    log.push({
      ts: verification.at,
      text: 'Pasaport FULL-TİK: tüm maddeler insan onaylı — ürün geliştirildi 🎉',
      source: 'ocean' as const,
    });
  }

  // ── kart + state + pano tazele ──
  let scripts: Record<string, string> = {};
  try {
    scripts = scriptsFromPackageJson(await readFile(join(cwd, 'package.json'), 'utf8'));
  } catch {
    /* package.json yok — öneri git status'a düşer */
  }
  const card = buildCard(claims, { scripts, now });

  const next: OceanState = {
    ...state,
    updatedAt: verification.at,
    claims,
    passport,
    log,
    card,
    ...(fullTickNotifiedAt !== undefined ? { fullTickNotifiedAt } : {}),
  };
  await writeState(cwd, next);
  const goalText = await readGoal(cwd);
  await writePano(cwd, renderPano(next, { goalText }));

  deps.out('');
  deps.out(
    onaylananlar.length > 1
      ? `Onay kaydedildi: ${onaylananlar.length} kayıt → insan-onayı (${by}).`
      : `Onay kaydedildi: ${(onaylananlar[0] as Claim).id} → insan-onayı (${by}).`,
  );
  deps.out(`Pasaport: ${passport.filter((p) => p.status === 'completed' && p.level === 'insan-onayi').length}/${passport.length} doğrulandı.`);
  if (fullTick) deps.out('Pasaport FULL-TİK — ürün geliştirildi 🎉');

  return { ok: true, approved: true, fullTick, notified, panoPath: panoPath(cwd) };
}
