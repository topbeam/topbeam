# Ocean

Vibe coder için dürüst proje panosu. Ocean sana projenin hikâyesini anlatmaz;
**mevcut gerçeği ve ilerlemek için gereken tek hareketi söyler.**

Local-first: LLM çağrısı yok, network çağrısı yok. Özet **deterministiktir** —
Claude Code transcript'lerindeki tool-use kayıtları + git gerçeklerinden üretilir;
halüsinasyon yapısal olarak imkânsızdır (assistant'ın "bitti, çalışıyor!" cümlesi
özete hiçbir yoldan giremez).

## Kurulum

Marka adı **OCEAN**, komut adı **`ocean`**, npm paket adı **`ocean-code`**
(npm'de `ocean` ve `ocean-cli` adları başka kişilerin ilgisiz paketleridir —
kurulum komutunda paket adı `ocean-code`'dur).

> **Durum: Ocean henüz npm'e yayınlanmadı.** Bugün çalışan tek yol aşağıdaki
> yerel kurulumdur. `npx` yolu yayından sonra çalışacak; bugün çalıştığını
> söylemek yalan olur, o yüzden ayrı başlıkta ve açıkça işaretli.

### Bugün çalışan yol — yerelden kurulum

```bash
cd ocean-cli        # bu deponun klasörü
npm install
npm run build
npm link            # `ocean` komutu PATH'e girer
```

Kurulumu doğrula:

```bash
ocean --help        # yardım metni ve sürüm görünmeli
```

Geri almak: `npm unlink -g ocean-code`.

`npm link` istemiyorsan global kurulum yapmadan da çalıştırabilirsin:

```bash
node /tam/yol/ocean-cli/dist/cli.js sync
```

### Yayından sonra (henüz ÇALIŞMAZ)

Paket npm'e `ocean-code` adıyla yayınlandığında şu komutlar çalışacak:

```bash
npx ocean-code init            # yayın öncesi çalışmaz
npx -p ocean-code ocean init   # aynısının kesin biçimi (paket ≠ komut adı)
npm i -g ocean-code            # `ocean` komutunu global kurar
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
- pasaport **FULL-TİK** olursa bir kez macOS bildirimi: "Ocean: ürün geliştirildi 🎉"
  (planlanan fiyatlamada bu bildirim Pro tarafında — bugünkü sürümde herkeste açık,
  kodda lisans kontrolü yok; bkz. [Fiyat](#fiyat-planlanan--açık-çekirdek)).

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
- Manuel doğrulama (`ocean verify`)
- Temel pasaport kaydı (o projeye ait)

**Ocean Pro — $5/ay · $50/yıl (founding fiyatı, sonra $9)**
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
