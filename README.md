# Topbeam

Vibe coder için dürüst proje panosu. Topbeam sana projenin hikâyesini anlatmaz;
**mevcut gerçeği ve ilerlemek için gereken tek hareketi söyler.**

Local-first: LLM çağrısı yok, network çağrısı yok. Özet **deterministiktir** —
Claude Code transcript'lerindeki tool-use kayıtlarından + git gerçeklerinden üretilir;
halüsinasyon yapısal olarak imkânsızdır (assistant'ın "bitti, çalışıyor!" cümlesi
özete hiçbir yoldan giremez).

**Topbeam by REVERI** — *"topping out"*: inşaatta son kirişin en tepeye çakılması,
bitiş töreni. BuildPassport barının dolması budur.

## Kurulum

Komut adı **`topbeam`**, npm paket adı da **`topbeam`** — tek ad, tek token.
(Kısaltma yok: `beam` takma adı verilmez.)

> **Durum: Topbeam henüz npm'e YAYINLANMADI.** Bugün çalışan tek yol aşağıdaki
> yerel kurulumdur. `npx` / `npm i -g` yolu yayından sonra çalışacak; bugün
> çalıştığını söylemek yalan olur, o yüzden ayrı başlıkta ve açıkça işaretli.

### Bugün çalışan yol — yerelden kurulum

```bash
git clone <depo>    # GitHub org (topbeam) henüz açılmadı — açılınca URL buraya
cd ocean-cli        # bu deponun klasörü (klasör adı henüz taşınmadı)
npm install
npm run build
npm link            # `topbeam` komutu PATH'e girer
```

Kurulumu doğrula:

```bash
topbeam --help      # yardım metni ve sürüm görünmeli
```

Geri almak: `npm unlink -g topbeam`.

`npm link` istemiyorsan global kurulum yapmadan da çalıştırabilirsin:

```bash
node /tam/yol/ocean-cli/dist/cli.js sync
```

### Yayından sonra (henüz ÇALIŞMAZ)

Paket npm'e `topbeam` adıyla yayınlandığında şu komutlar çalışacak:

```bash
npx topbeam init    # yayın öncesi çalışmaz
npm i -g topbeam    # `topbeam` komutunu global kurar
```

Gereksinim: Node >= 20. Çalışma zamanı bağımlılığı yok (tek dosya bundle).

### Depo ve bağlantılar

GitHub organizasyonu (`topbeam`) henüz açılmadı; bu yüzden `package.json` içindeki
`repository` / `bugs` / `homepage` alanları **boş** — uydurma URL yazılmadı.
Org açılınca üç alan da buraya ve `package.json`'a eklenecek.

## Veri dizini: neden hâlâ `.ocean/`

Marka Topbeam, ama proje kökündeki veri dizini **`.ocean/`** ve içindeki dosya
adları (`state.json`, `pano.html`, `passport.jsonl`, `goal.md`, `notes.md`)
**değişmedi** — bilinçli karar: mevcut kurulumlarda veri göçü riski almıyoruz.
Aynı gerekçeyle ortam değişkenleri de `OCEAN_*` önekini koruyor.

## 4 Komut

### `topbeam init`
Projeyi Topbeam'e bağlar — kullanıcı elle iş yapmaz:
- `.ocean/` kurulur: `state.json` (durum), `goal.md` (hedef), `notes.md` (kısa notlar)
- Projenin `CLAUDE.md`'sine **"## Topbeam"** bölümü eklenir (varsa dokunmaz):
  Claude'a talimat — hedefi güncel tut, önemli adımlarda 1 satır Türkçe not ekle,
  kanıtsız "çalışıyor" deme.

### `topbeam sync`
Claude Code transcript'leri (`~/.claude/projects/...`) + git gerçeklerini okur →
kanıt-kurallı iddialar (claim), LOG HISTORY ve **sıradaki-tek-hareket kartını**
üretir → `.ocean/pano.html` yazar. İnsan onayları asla geri alınmaz.

### `topbeam verify <id>`
Bir iddiayı gösterir, kanıtlarını listeler, onayını sorar (e/H). Onaylarsan:
- iddia **insan-onayı** seviyesine yükselir (tek meşru yükseltme yolu budur),
- `.ocean/passport.jsonl`'e eklenir (append-only, değişmez onay logu),
- pasaport **FULL-TİK** olursa bir kez macOS bildirimi: "Topbeam: ürün geliştirildi 🎉"
  (planlanan fiyatlamada bu bildirim Pro tarafında — bugünkü sürümde herkeste açık,
  kodda lisans kontrolü yok; bkz. [Fiyat](#fiyat-planlanan--açık-çekirdek)).

### `topbeam open`
Pano yolunu yazdırır. Tarayıcıyı **otomatik açmaz** — sen açarsın.

## Pano (`.ocean/pano.html`)

Tek statik dosya, sistem fontları, tek küçük JS (kopyala butonu). Üstten alta:
1. **Sıradaki tek hareket** (en baskın öğe): şu anki gerçek + kesinlik seviyesi ·
   kanıt üç ayrı satır (git diff / test çıktısı / insan onayı) · en önemli tek
   bilinmeyen · tek fiil + çalıştırılabilir komut · neden bu · bitti sayılma koşulu ·
   "Doğrulamayı başlat" kutusu (`topbeam verify <id>` kopyalanabilir).
2. **Log history**: zaman çizgisi — git/test gerçekleri, Claude'un beyanları
   ("beyan" rozetiyle; kanıt değil), insan onayları.
3. **Pasaport**: tik listesi + dürüst sayım ("1/2 doğrulandı" — yüzde-progress-bar
   yok). Tüm maddeler insan onaylıysa kutlama bandı.

## Kart neyi seçer? (kural merdiveni)

Kart, doğrulanmamış işler arasından **riski en yükseğini** seçer ve "Neden bu?"
satırında gerekçesini söyler. Sıra sabittir, ilk eşleşen kazanır — hepsi
deterministik, LLM yok:

| # | Kural | Ne zaman | Gerekçe cümlesi neyi söyler |
|---|-------|----------|------------------------------|
| 1 | `kirik-test` | Test çıktısında okunmuş başarısız sayısı ya da gerçek hata çıkışı (exit 1–127) | kaç test başarısız / hangi exit |
| 2 | `kritik-dosya` | Doğrulanmamış iş ödeme · kimlik/oturum · veri şeması · yapılandırma dosyasına dokunmuş | tür + dosya adı |
| 3 | `kayip-riski` | 4+ dosyalık küme, git kaydında izi yok | kümenin dosya sayısı |
| 4 | `bayat` | Doğrulanmamış işlerin **hepsi** 3+ gün eski (taze iş yok) | en uzun bekleyen kaç gün |
| 5 | `kume` | Aynı oturumda 2+ doğrulanmamış kayıt | kümedeki kayıt sayısı + kapsam |
| 6 | `en-yeni` | Temel kural / geri sarma | "en son dokunulan doğrulanmamış iş" |

Sınırlar açıkça çizilidir:
- Kural yalnız **ölçülmüş** sinyalden çalışır (dosya sayısı, yol, git izi, okunan
  test sayıları). Sinyal yoksa kural susar, kart `en-yeni`'ye geri sarar —
  iddia metni ayrıştırılmaz (metin eşleştirme yanlış pozitif üretir).
- Kritik dosya eşleşmesi **token tamlığı** ister: `src/auth/login.ts` kritik,
  `src/author.ts` ve `tokens.css` değil. Kaçırmak, yanlış suçlamaktan iyidir.
- Sinyalle ölen koşum (exit ≥ 128: zaman aşımı, Ctrl-C) **kırık test sayılmaz** —
  o bir kesintidir.
- Hiçbir kural kanıt seviyesini değiştirmez: `doğrulanmadı` → `doğrulanmadı` kalır.
  Kurallar yalnız **sırayı ve gerekçeyi** belirler.

## Dürüstlük İlkesi (ürünün anayasası)

- **Kanıtsız iddia gösterilmez.** Kanıt seviyeleri: `dosya-kanıtı` (transcript ∩ git),
  `test-kanıtı` (çıktıdan okunan geçti/kaldı sayısı), `insan-onayı` (sen doğruladın),
  `doğrulanmadı` ("uygulandı görünüyor, doğrulanmadı").
- **"Çalışıyor" asla otomatik söylenmez** — yalnız test kanıtı veya insan onayıyla.
- Sayı uydurulmaz: test çıktısından sayı okunamadıysa iddia `doğrulanmadı` kalır.
- Yüzde-ilerleme, motivasyon sözü, kırmızı alarm yok. Sakin, dürüst Türkçe.
- Diske giden her metin secret-maskeleme filtresinden geçer (API anahtarı,
  token, parola desenleri maskelenir).

## Fiyat (planlanan) · açık çekirdek

> **Bugünkü gerçek:** ödeme sayfası yok ve bu sürüm hiçbir özelliği kilitlemiyor —
> kodda lisans kontrolü yok. Aşağıdaki sınır, çizmeyi *planladığım* sınır.
> Kurmadan önce bilinmesi için burada; kurulduktan sonra öğrenilmesi için değil.

**Free — $0, tek proje, süre sınırı yok**
- Tek proje
- Tam kart — sıradaki tek hareket
- Log geçmişi
- Manuel doğrulama (`topbeam verify`)
- Temel pasaport kaydı (o projeye ait)

**Topbeam Pro — $5/ay · $50/yıl (founding fiyatı, sonra $9)**
- Sınırsız proje
- Projeler arası taşınabilir pasaport geçmişi
- FULL-TİK bildirimi + gelişmiş doğrulama akışları
- Founding fiyatı satın alındığı sürece korunur

**Açık çekirdek (open core).** Okuyucu çekirdek — transcript ayrıştırma, git kesişimi,
kanıt kuralları, kart — **MIT** lisanslı (`LICENSE`, `package.json` → `"license": "MIT"`;
paket içinde de gelir). Ücretli katman kapalı kalır.

Bu sınır üç yerde **birebir** aynıdır ve burası tek gerçek kaynağıdır:
bu README · `site/index.html` fiyat bölümü · `TEK-PAKET/OCEAN-LANSMAN-KITI.md`
(Reddit / HN / X metinleri). Biri değişirse üçü birlikte değişir.

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
