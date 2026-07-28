# Ocean

Vibe coder için dürüst proje panosu. Ocean sana projenin hikâyesini anlatmaz;
**mevcut gerçeği ve ilerlemek için gereken tek hareketi söyler.**

Local-first: LLM çağrısı yok, network çağrısı yok. Özet **deterministiktir** —
Claude Code transcript'lerindeki tool-use kayıtları + git gerçeklerinden üretilir;
halüsinasyon yapısal olarak imkânsızdır (assistant'ın "bitti, çalışıyor!" cümlesi
özete hiçbir yoldan giremez).

## Kurulum

```bash
cd ocean-cli
npm install
npm run build
npm link        # `ocean` komutu PATH'e girer
```

Gereksinim: Node >= 20. Çalışma zamanı bağımlılığı yok (tek dosya bundle).

## 4 Komut

### `ocean init`
Projeyi Ocean'a bağlar — kullanıcı elle iş yapmaz:
- `.ocean/` kurulur: `state.json` (durum), `goal.md` (hedef), `notes.md` (kısa notlar)
- Projenin `CLAUDE.md`'sine **"## Ocean"** bölümü eklenir (varsa dokunmaz):
  Claude'a talimat — hedefi güncel tut, önemli adımlarda 1 satır Türkçe not ekle,
  kanıtsız "çalışıyor" deme.

### `ocean sync`
Claude Code transcript'leri (`~/.claude/projects/...`) + git gerçeklerini okur →
kanıt-kurallı iddialar (claim), LOG HISTORY ve **sıradaki-tek-hareket kartını**
üretir → `.ocean/pano.html` yazar. İnsan onayları asla geri alınmaz.

### `ocean verify <id>`
Bir iddiayı gösterir, kanıtlarını listeler, onayını sorar (e/H). Onaylarsan:
- iddia **insan-onayı** seviyesine yükselir (tek meşru yükseltme yolu budur),
- `.ocean/passport.jsonl`'e eklenir (append-only, değişmez onay logu),
- pasaport **FULL-TİK** olursa bir kez macOS bildirimi: "Ocean: ürün geliştirildi 🎉".

### `ocean open`
Pano yolunu yazdırır. Tarayıcıyı **otomatik açmaz** — sen açarsın.

## Pano (`.ocean/pano.html`)

Tek statik dosya, sistem fontları, tek küçük JS (kopyala butonu). Üstten alta:
1. **Sıradaki tek hareket** (en baskın öğe): şu anki gerçek + kesinlik seviyesi ·
   kanıt üç ayrı satır (git diff / test çıktısı / insan onayı) · en önemli tek
   bilinmeyen · tek fiil + çalıştırılabilir komut · neden bu · bitti sayılma koşulu ·
   "Doğrulamayı başlat" kutusu (`ocean verify <id>` kopyalanabilir).
2. **Log history**: zaman çizgisi — git/test gerçekleri, Claude'un beyanları
   ("beyan" rozetiyle; kanıt değil), insan onayları.
3. **Pasaport**: tik listesi + dürüst sayım ("1/2 doğrulandı" — yüzde-progress-bar
   yok). Tüm maddeler insan onaylıysa kutlama bandı.

## Dürüstlük İlkesi (ürünün anayasası)

- **Kanıtsız iddia gösterilmez.** Kanıt seviyeleri: `dosya-kanıtı` (transcript ∩ git),
  `test-kanıtı` (çıktıdan okunan geçti/kaldı sayısı), `insan-onayı` (sen doğruladın),
  `doğrulanmadı` ("uygulandı görünüyor, doğrulanmadı").
- **"Çalışıyor" asla otomatik söylenmez** — yalnız test kanıtı veya insan onayıyla.
- Sayı uydurulmaz: test çıktısından sayı okunamadıysa iddia `doğrulanmadı` kalır.
- Yüzde-ilerleme, motivasyon sözü, kırmızı alarm yok. Sakin, dürüst Türkçe.
- Diske giden her metin secret-maskeleme filtresinden geçer (API anahtarı,
  token, parola desenleri maskelenir).

## Ortam değişkenleri

| Değişken | Ne yapar |
|---|---|
| `OCEAN_CLAUDE_DIR` | `~/.claude` yerine kullanılacak kök (test/izolasyon) |
| `OCEAN_NO_NOTIFY=1` | macOS bildirimini tümden kapatır |
| `OCEAN_NOTIFY_BIN` | `osascript` yerine binary (test) |

## Geliştirme

```bash
npm test            # node:test — tamamı izole (gerçek ~/.claude'a dokunmaz)
npm run typecheck   # tsc --noEmit (strict)
npm run build       # esbuild → dist/cli.js
```
