# Claude Code: Yeni PC'de Devam Prompt'u

`KURULUM.md` adımlarını (özellikle adım 8, hafıza geri yükleme) bitirdikten
sonra proje klasöründe `claude` komutunu çalıştır ve aşağıdaki bloğu olduğu gibi
yapıştır.

---

```text
Bu proje yeni bir PC'ye taşındı; eski makinede seninle birlikte geliştirdiğimiz
Ocean Distro Finder / Virus Records projesine buradan devam edeceğiz.

Bağlam:
- Repo: https://github.com/oceanyazilim/df-archive (aktif dal: redesign; eski
  origin oceanyazilim/oceandistrofinder-desktop).
- Proje notların docs/claude-memory/ altında ve hafıza klasörüne geri yüklendi.
  Önce MEMORY.md ile tüm memory dosyalarını oku. Özellikle desktop-app,
  distributor-resolution-architecture, spotify-client-constraints,
  license-system ve artist-catalog.
- Kurulum rehberi: KURULUM.md. Mimari: README.md, desktop/README.md,
  license-panel/README.md, spicetify/README.md.

Bileşenler:
1. Next.js 14 paneli (app/, src/): Spotify linki → licensor UUID →
   json/uuid's.json ile birebir eşleşme → distribütör. Distribütör SADECE
   licensor UUID eşleşmesinden belirlenir; label/ISRC/Soundcharts asla kullanılmaz.
2. Electron masaüstü uygulaması (desktop/): Next standalone sunucusu
   127.0.0.1:3000'de. Spotify'a CDP (9222) üzerinden bağlanıp protobuf metadata
   alır. Self-healing: adopt mode, companion watchdog, firstRunSetup.
3. Spicetify eklentisi (spicetify/distro-finder.js): Spotify içinde sağ tık
   Distro Finder + Ocean Analyzer. Spicetify >= 2.45.1 gerekli (Spotify 1.3.x).
4. Lisans paneli (license-panel/): Dokploy'da distro.virusrecord.com; key
   türleri, IP/zaman denetimi, 15 dk heartbeat, 7 gün offline tolerans.
5. Kimlik havuzları: Spotify/Soundcharts numaralı env slotlarıyla otomatik failover.

Kritik kurallar (eski oturumlardan):
- Spicetify yükleyicisi hata yolunda her zaman `spicetify restore` yapmalı.
  Müşterinin Spotify'ını bozuk bırakmak bir kez yaşandı, tekrarlanmamalı.
- next dev açıkken next build / desktop:prepare çalıştırma (.next bozulur).
- Soundcharts çağrıları sıralı olmalı (paralel çağrı rate-limit'e takılıyor).
- Gizli değerler (.env.local) asla commit'lenmez, ekrana yazdırılmaz.

İlk iş olarak:
1. Gizli dosyaları içe aktar. Git'e girmeyen .env.local ve .data\ dosyaları
   eski PC'den C:\ocean-development\usbiçin-df\ klasöründe geldi (Drive/USB).
   Proje kökünde .env.local yoksa ve bu klasör varsa şunu çalıştır:
   powershell -ExecutionPolicy Bypass -File scripts/import-usb-secrets.ps1
   Klasör bulunamazsa nerede olduğunu bana sor. Değerleri asla okuma veya
   yazdırma; script'in listelediği değişken adları yeterli.
2. Ortamı doğrula: node -v, git status, .env.local'de hangi anahtarların dolu
   olduğu (sadece adlar), npm install, npm test, npm run typecheck.
3. Eksik kalan kurulum adımı varsa KURULUM.md'ye göre söyle.
4. Sonra ne üzerinde çalışacağımızı sor. Hafızadaki açık fikir:
   companion watchdog'u, dosya durumuna ek olarak CDP üzerinden
   Spicetify.React (wrapper sağlığı) kontrol edecek şekilde genişletmek.

Yanıtlarını Türkçe ver.
```

---

## İpuçları

- Hafıza yüklenmediyse Claude'a şunu söyle: "docs/claude-memory/ klasöründeki
  tüm .md dosyalarını oku ve bunları proje hafızası olarak kabul et."
- Eski PC'de işin ortasında kalan, commit'lenmemiş bir şey yoktu. Son commit:
  `2284858 fix(spotify): never leave a broken client`.
