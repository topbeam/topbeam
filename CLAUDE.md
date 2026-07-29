
## Topbeam

Bu proje Topbeam ile izleniyor — dürüst proje panosu (`.ocean/pano.html`).

Claude, bu projede çalışırken şu alışkanlıkları uygula:
1. **Hedef:** Proje hedefi değiştiğinde `.ocean/goal.md` dosyasının "Proje Hedefi"
   paragrafını güncel tut (kısa, tek paragraf). Aynı dosyadaki `- [ ]` **teslim
   sözleri kullanıcınındır — ekleme, silme, yeniden yazma.** Bar o satırlardan kurulur;
   sözü yazan da onaylayan da insandır.
2. **Not:** Önemli her adımda `.ocean/notes.md` dosyasına 1 satırlık Türkçe not EKLE (append, eskiyi silme):
   `- YYYY-MM-DD HH:MM — ne yapıldı` biçiminde.
3. **Dürüstlük:** Kanıt görmeden "çalışıyor / bitti" deme; "uygulandı görünüyor, doğrulanmadı" de.
   Doğrulama kullanıcıya aittir: `topbeam verify <id>`.
4. **Senkron:** Anlamlı bir iş bitince `topbeam sync` çalıştır — pano ve kart güncellensin.
