# Topbeam

Vibe coder için dürüst proje panosu. Topbeam sana projenin hikâyesini anlatmaz;
**mevcut gerçeği ve ilerlemek için gereken tek hareketi söyler.**

Local-first: **LLM çağrısı yok.** Özet **deterministiktir** —
Claude Code transcript'lerindeki tool-use kayıtlarından + git gerçeklerinden üretilir.
**Modelin CÜMLESİ özete giremez** (assistant'ın "bitti, çalışıyor!" metni hiçbir yoldan
okunmaz; yalnız `tool_use`/`tool_result` yapısal alanları okunur) ve ekranda gördüğün her
sayı bir ölçümden gelir.

> **Ama "deterministik" ≠ "her zaman doğru".** İddiaları kayıtlara bağlayan eşleme
> sezgisel kurallarla (yol/uzantı/etiket) çalışır; yanlış eşleşme ve kaçırma mümkündür
> ve kod bunu açıkça tercih eder: *kaçırmak, yanlış suçlamaktan iyidir.*
> "Halüsinasyon imkânsız" cümlesi bu üründe kullanılmaz — fazla söz vermek de bir yalandır.

**Tek dış kaynak: opsiyonel CI okuması.** `gh` kurulu ve girişliyse Topbeam
"bu commit CI'da yeşil mi?" sorusunu sorar — lokalde öğrenemeyeceğin tek gerçek.
`gh` yoksa, giriş yoksa ya da ağ yoksa zarif geçer; `--no-ci` / `TOPBEAM_NO_CI=1`
ile tümden kapanır ve Topbeam **tek dış çağrı bile yapmaz**
(bkz. [CI (opsiyonel)](#ci-opsiyonel)).

**Topbeam by REVERI** — *"topping out"*: inşaatta son kirişin en tepeye çakılması,
bitiş töreni. BuildPassport barının dolması budur.

## Kurulum

Komut adı **`topbeam`**, npm paket adı da **`topbeam`** — tek ad, tek token.
(Kısaltma yok: `beam` takma adı verilmez.)

```bash
npx topbeam init          # kurmadan dene
npm i -g topbeam          # ya da kalıcı kur
```

`topbeam@0.1.0` npm'de yayında (MIT, çalışma zamanı bağımlılığı yok).

### Kaynaktan kurulum

```bash
git clone https://github.com/topbeam/topbeam.git
cd topbeam
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

Gereksinim: Node >= 20. Çalışma zamanı bağımlılığı yok (tek dosya bundle).

### Depo ve bağlantılar

- Kaynak (MIT çekirdek): <https://github.com/topbeam/topbeam>
- npm: <https://www.npmjs.com/package/topbeam>
- Landing: <https://topbeam.surge.sh>

## Veri dizini: neden hâlâ `.ocean/`

Marka Topbeam, ama proje kökündeki veri dizini **`.ocean/`** ve içindeki dosya
adları (`state.json`, `pano.html`, `passport.jsonl`, `goal.md`, `notes.md`)
**değişmedi** — bilinçli karar: mevcut kurulumlarda veri göçü riski almıyoruz.
Aynı gerekçeyle ortam değişkenleri de `OCEAN_*` önekini koruyor.

## 5 Komut

### `topbeam init`
Projeyi Topbeam'e bağlar — kullanıcı elle iş yapmaz:
- `.ocean/` kurulur: `state.json` (durum), `goal.md` (hedef **+ teslim sözleri**),
  `notes.md` (kısa notlar). `goal.md` anlamlı bir şablonla gelir: 7 evrensel
  teslim kapısı örneği — sil, kendi sözlerini yaz.
- Projenin `CLAUDE.md`'sine **"## Topbeam"** bölümü eklenir (varsa dokunmaz):
  Claude'a talimat — hedefi güncel tut, önemli adımlarda 1 satır Türkçe not ekle,
  kanıtsız "çalışıyor" deme.

### `topbeam sync`
Claude Code transcript'leri (`~/.claude/projects/...`) + git gerçeklerini okur →
kanıt-kurallı iddialar (claim), LOG HISTORY ve **sıradaki-tek-hareket kartını**
üretir → `.ocean/pano.html` yazar. İnsan onayları asla geri alınmaz.

Bayrak: `topbeam sync --no-ci` → opsiyonel CI okuması hiç yapılmaz (aşağı bak).

### `topbeam verify <id>`
Bir iddiayı gösterir, kanıtlarını listeler, onayını sorar (e/H). Onaylarsan:
- iddia **insan-onayı** seviyesine yükselir (tek meşru yükseltme yolu budur),
- `.ocean/passport.jsonl`'e eklenir (append-only, değişmez onay logu),
- **bar dolarsa** (her teslim sözü insan onaylı) bir kez `.ocean/muhur.md` yazılır
  + macOS bildirimi: "Topbeam: ürün geliştirildi 🎉"
  (planlanan fiyatlamada bu bildirim Pro tarafında — bugünkü sürümde herkeste açık,
  kodda lisans kontrolü yok; bkz. [Fiyat](#fiyat-planlanan--açık-çekirdek)).

`<id>` tek bir kayıt ya da bir **teslim sözü** (`soz-…`) olabilir. Söz verirsen o
söze eşleşen tüm kayıtlar ekrana dökülür ve tek soruyla onaylanır. Kaydı olmayan
söz onaylanamaz ve 10'dan çok kaydı kapsayan söz için soru sorulmadan önce
uyarılırsın — Topbeam lastik damga vurdurmaz.

> #### ⚠️ Bu kapının sınırı — ölçüldü, gizlenmiyor
> Onay yalnız `process.stdin.isTTY` doğruysa yazılır. Bu, **düz pipe/yönlendirmeyi**
> keser: `echo e | topbeam verify …` onay YAZMAZ, soru bile sorulmaz. Yani onay
> **kazayla ya da bir betiğin yan etkisiyle** oluşamaz.
>
> **Ama bu bir duvar değil, kasis.** macOS'ta hazır gelen `script(1)` sahte bir pty
> açar ve `isTTY`'yi `true` yapar; `expect`, python `pty`, `node-pty` de aynısını
> yapar. Yani onay vermeyi **bile isteye** otomatikleştirmek isteyen biri bunu geçer.
>
> Kurulabilecek en güçlü **doğru** cümle budur. *"Bot onay veremez"*,
> *"ajan taklit edemez"*, *"yapısal olarak imkânsız"* cümlelerinin hiçbiri doğru
> değildir ve bu üründe kullanılmaz — yanlış etiketli bir dürüstlük rozeti, hiç
> rozet olmamasından kötüdür. (Bir test bu cümlelerin geri gelmesini engelliyor:
> `src/verify.test.ts` → *"kaynak metinlerde mutlakçı kapı iddiası bulunmaz"*.)

### `topbeam open`
Pano yolunu yazdırır. Tarayıcıyı **otomatik açmaz** — sen açarsın.

### `topbeam makbuz`
**Dışarıya** gösterilebilir tek sayfalık teslim makbuzu üretir:
`.ocean/makbuz.md` (`--html` eklersen ayrıca `.ocean/makbuz.html`). Pano *içeri*
bakar (senin ekranın), makbuz *dışarı* gider — müşteriye, ekibe, işverene
yapıştırılır. Dosyayı yazar, yolu söyler; **açmaz, göndermez, yayınlamaz**.

## Pano (`.ocean/pano.html`)

Tek statik dosya, sistem fontları, tek küçük JS (kopyala butonu). Üstten alta:
1. **Sıradaki tek hareket** (en baskın öğe): şu anki gerçek + kesinlik seviyesi ·
   kanıt üç ayrı satır (git diff / test çıktısı / insan onayı) · en önemli tek
   bilinmeyen · tek fiil + çalıştırılabilir komut · neden bu · bitti sayılma koşulu ·
   "Doğrulamayı başlat" kutusu (`topbeam verify <id>` kopyalanabilir).
2. **Teslim sözleri + BAR** (kartın hemen altında, kart baskın kalır):
   `goal.md`'deki her `- [ ]` satırı bir bölme. Sayım "3 / 7 madde onaylandı" —
   **yüzde yok**, kısmi doluluk yok. Bölme yalnız `passport.jsonl` defterindeki
   terminal imzalı insan onayıyla dolar. Söz yoksa bar **hiç çizilmez**
   ("Teslim sözlerini `.ocean/goal.md`'ye yaz, bar orada dolsun") — boş bar
   sahte affordance olurdu.
3. **Bu panonun kapsamı**: neyin, kaç tanesinin elendiği (iz bırakarak).
4. **Log history**: zaman çizgisi — git/test gerçekleri, Claude'un beyanları
   ("beyan" rozetiyle; kanıt değil), insan onayları.
5. **Defter**: oturum kayıtları arşivi — nötr sayım ("11 oturum kaydı ·
   *bu bir ilerleme ölçüsü değildir*"). Satırlarında `verify` komutu öne
   çıkarılmaz: 99 dosyalık bir arşiv birimine onay istemek lastik damga üretir.

## Bar neden `goal.md`'den geliyor? (Sisifos barı)

Eskiden bar birimi bir **Claude Code oturumuydu**. Sonuç: her yeni kodlama
oturumu paydayı büyütüyordu — bugün 0/11, yarın çalışırsan 0/12. Çalıştıkça bar
senden uzaklaşıyordu. Üstelik "2026-07-11 · 99 dosya · 40 test koşumu" bir ürün
sözü değil, arşiv kaydıdır; 99 dosyalık bir birime onay istemek lastik damga
üretir ve insan onayını değersizleştirir.

Şimdi **birim = insanın yazdığı söz**: `.ocean/goal.md` içindeki `- [ ]`
satırları. Sonlu, kilitli, insan tanımlı. Oturum eklemek paydayı büyütmez; payda
ancak sen yeni bir söz yazınca büyür.

### Kanıt eşleme kuralları (deterministik, LLM yok)

Bir söz satırı, kayıtlara şu ipuçlarıyla bağlanır:

| İpucu | Yazım | Ne eşleşir |
|-------|-------|------------|
| yol | `src/auth`, `src/cli.ts`, `README.md` | O yola (ya da o dizinin altına) dokunan kayıtlar |
| test | satır `test:` ile başlar | Yalnız test koşumu kayıtları |
| etiket | satır içinde `#odeme` | Kaydın metninde ya da yolunda geçen etiket |

- Bir sözün **seviyesi** = eşleşen kayıtların **en yüksek** kanıt seviyesi.
- İpucu yoksa ya da hiçbir kayıt eşleşmezse madde **"kanıt yok"** durur —
  eşleşme asla uydurulmaz.
- Yol ipuçları ASCII'dir: "giriş/çıkış" gibi Türkçe ifadeler yol sanılmaz.
- `test:` + yol birlikte yazılırsa ikisi de sağlanmalıdır.
- `- [x]` diye elle atılan tik bir **beyandır**, barı doldurmaz (öyle işaretlenir).
- Söz metnini değiştirirsen id değişir: eski onay yeni cümleyi kapsamaz
  (kayıt `passport.jsonl` defterinde durmaya devam eder).

## Mühür (`.ocean/muhur.md`)

Bar dolduğunda — "topping out": inşaatta son kirişin tepeye çakılması — bir kez
yazılır. Kapsamı dürüstçe söyler: kaç söz, ne zaman kilitlendi, hangi kayıtlara
ve hangi imzalara dayanıyor; ve **ne demek olmadığını** ("ürün hatasız" demek
değildir). Mühür yalnız son **onay** anında yazılır — söz silerek mühür alınamaz.

## Makbuz (`.ocean/makbuz.md`) — dışarıya gösterilen tek sayfa

Pano özeldir; **makbuz paylaşılır.** `topbeam makbuz` tek sayfalık, Markdown
(yapıştırılabilir) bir teslim kaydı üretir — istersen `--html` ile tek dosya
HTML de (gömülü stil, **sıfır dış istek**, JS yok).

İçinde ne var:
- proje adı · tarih · araç sürümü · hedef cümlesi (beyan olduğu yazılı),
- **teslim sözleri**, her birinin kanıt seviyesi ve durumu,
- **kanıt özeti**: kaç dosya-kanıtı / test-kanıtı / insan onayı, son test ölçümü,
  ve state'ten okunan **commit SHA'ları**,
- **"bilmedikleri"**: neyin elendiği (proje dışı düzenleme, ilişkisiz beyan,
  kontrol komutu, log satır zinciri), git deposu değilse o not,
- **"ne demek DEĞİL"**: makbuzun kendi sınırları.

**Üçüncü kişi yeniden doğrulayabilsin diye** makbuzun ortasında kopyalanabilir
bir blok durur — "bana güven" yok, "kendin bak" var:

```sh
git show <sha> --stat     # SHA'lar bu depodan okundu (yoksa "kayıt yok" yazar)
npm test                  # test komutu package.json'dan; yoksa uydurulmaz
cat .ocean/passport.jsonl # insan onaylarının değişmez kaydı
topbeam sync && topbeam makbuz   # makbuzu sıfırdan yeniden üret
```

Dürüstlük kapıları (testlerle kilitli):
- Bir madde ancak `passport.jsonl` defterindeki **terminal imzalı** onaya
  bağlanıyorsa `- [x]` görünür. `completed` yazan ama defterde karşılığı olmayan
  madde **onaysız** gösterilir ve nedeni yazılır (silinmez, gizlenmez).
- SHA / komut / sayı **uydurulmaz**: kayıt yoksa "kayıt yok" der.
- Hiçbir şey onaylı değilken makbuz **yine üretilir**, ama başında
  "hiçbir madde henüz insan onaylı değil — bu bir teslim onayı DEĞİLDİR" yazar.
  Sahte mühür/rozet yoktur.
- Diske giden her metin gibi makbuz da sır maskelemesinden (`redact`) geçer —
  dışarı gidecek dosyada bu en kritik kapıdır.

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

## CI (opsiyonel)

Topbeam'in geri kalanı tümüyle lokaldir. CI, **tek dış kaynaktır** ve tek bir soruyu
sorar: *"bu commit CI'da yeşil mi?"* — terminalde 5 saniyede öğrenemeyeceğin tek gerçek.

**Nasıl çalışır**

| Durum | Topbeam ne yapar |
|---|---|
| `gh` kurulu + girişli + depo GitHub'da | `gh run list --json …` (salt-okunur, tek komut) |
| `gh` kurulu değil | Zarif geçer. **Kurulum İSTEMEZ.** Kapsam notu: "CI kaydı okunamadı: `gh` komutu kurulu değil" |
| Giriş yok / yetki yok / ağ yok / uzak depo yok | Zarif geçer + sebebi kapsam notuna tek satır yazar |
| `--no-ci` ya da `TOPBEAM_NO_CI=1` | **Tek dış çağrı bile yapılmaz** |

**Eşleşme kuralı — uydurma yok.** Bir CI koşumu ancak `head_sha` değeri bu deponun
bilinen bir commit'iyle **birebir** (40 hane, tam string) eşleşirse hesaba katılır.
Kısa hash **öneki yetmez**. Eşleşmeyen koşumlar atılır ve kaç tane atıldığı kapsam
notuna yazılır.

**Sonuç nasıl okunur**

- `success` → `test-kanıtı` seviyesinde claim: *"CI yeşil: 2 workflow `abc1234`
  commit'inde başarılı"*. Commit HEAD değilse **kaç commit geride olduğu** yazılır.
  Çalışma ağacın kirliyse *"CI bu değişiklikleri görmedi"* diye eklenir.
- `failure` → kırık sinyali: kart bunu `kirik-test` kuralıyla **her şeyin önüne**
  alır. "Bitti" koşulu lokal test değildir: *aynı commit'te CI yeşile dönmelidir* —
  lokalde `npm test` geçmesi CI'ı yeşil yapmaz, kart bunu açıkça yazar.
- Diğer sonuçlar (süren, iptal, atlanan) **claim üretmez**; kapsam notunda durur.
  Sonuç uydurulmaz.
- CI'da geçti/kaldı sayısı ve exit kodu **yoktur** → Topbeam de yazmaz.
  Ölçülen tek şey `failure` sonucudur.
- Yeşil CI, lokalde kayıtlı kırık bir koşumu **temizlemez** (farklı ölçüm, farklı
  ağaç); tersi de geçerlidir — lokal yeşil, kırmızı CI'ı manşetten düşürmez.

## Dürüstlük İlkesi (ürünün anayasası)

- **Kanıtsız iddia gösterilmez.** Kanıt seviyeleri: `dosya-kanıtı` (transcript ∩ git),
  `test-kanıtı` (çıktıdan okunan geçti/kaldı sayısı), `insan-onayı` (sen doğruladın),
  `doğrulanmadı` ("uygulandı görünüyor, doğrulanmadı").
- **`transcript ∩ git` iki yoldan kurulur** — *commit atmak kanıtı yok etmez:*
  1. **çalışma ağacı** — `diff --numstat HEAD` ∪ `status --porcelain`
  2. **commit** — o yola dokunan ve **düzenlemeden sonra** atılmış bir commit
     (kanıt satırı SHA'yı yazar; üçüncü kişi `git show <sha> --stat` ile bakabilir)

  > **Neden 2. madde var:** commit'lenip ağacı temizlenen dosya 1. kümede
  > görünmez. Yalnız 1'e bakıldığında aynı iş *"git'te izi yok — doğrulanmadı"*
  > diye yeni bir iddia doğuruyor, o iddia aynı teslim sözüne eşleşiyor ve söz
  > `completed`→`partial` düşüyordu. Ölçülen sonuç: **bar 2/2 → 1/2 geriliyordu**
  > — yani *işini commit'lemek barını boşaltıyordu.* (2026-07-29'da düzeltildi;
  > regresyon testleri `src/truth.test.ts` içinde.)
  >
  > **Zaman disiplini:** commit yalnız düzenlemeden **sonra** atıldıysa sayılır.
  > Aksi hâlde "bu dosya geçmişte bir kez commit'lenmiş" gibi zayıf bir gerçek,
  > güncel bir düzenlemenin kanıtı gibi görünürdü. Zaman okunamıyorsa commit
  > kanıtı **kurulmaz** — kaçırmak, yanlış suçlamaktan iyidir.
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
| `TOPBEAM_NO_CI=1` | Opsiyonel CI okumasını tümden kapatır (`--no-ci` ile aynı) — tek dış çağrı yapılmaz |

## Geliştirme

```bash
npm test            # node:test — tamamı izole (gerçek ~/.claude'a dokunmaz)
npm run typecheck   # tsc --noEmit (strict)
npm run build       # esbuild → dist/cli.js
```
