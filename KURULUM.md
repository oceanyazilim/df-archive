# Ocean Distro Finder / Virus Records — Yeni PC Kurulum Rehberi

Bu dosya, projeyi sıfır bir Windows PC'de ayağa kaldırıp kaldığın yerden devam
etmen için gereken her şeyi sırayla anlatır. Mimari ayrıntılar `README.md`,
`desktop/README.md`, `license-panel/README.md` ve `spicetify/README.md`
dosyalarında; geliştirme geçmişi ve "neden böyle" notları
`docs/claude-memory/` altında.

> Claude Code ile devam edeceksen önce bu rehberi bitir, sonra
> `CLAUDE_PROMPT.md` içindeki prompt'u yapıştır.

---

## 0. Eski PC'den elle taşınacaklar (git'te YOK)

Bunlar gizli bilgi ya da makineye özel veri olduğu için repoya girmez. USB,
parola yöneticisi veya şifreli arşivle taşı, **asla** repoya commit'leme:

| Dosya / klasör (eski PC) | Ne işe yarar | Zorunlu mu |
|---|---|---|
| `C:\ocean-development\distro-finder\.env.local` | Spotify / Soundcharts anahtarları (yedek slotlar dahil), `ADMIN_PASSWORD`, `APP_SECRET` | **Evet** (yoksa analiz ekranları çalışmaz) |
| `C:\ocean-development\distro-finder\.data\` | `history.json` (admin geçmişi), `connectors.json` | Hayır |
| `%APPDATA%\distro-finder-desktop\` | Masaüstü uygulamanın lisans aktivasyonu, Spotify hesap bağlantısı, köprü anahtarı | Hayır. Yeni PC'de key ile yeniden aktive etmek daha temiz |
| License panel verisi | Canlı panelde (Dokploy `/data` volume). PC'de bir şey yok | Hayır |

`.env.local` kaybolduysa: `.env.example`'ı kopyala ve anahtarları
developer.spotify.com ile Soundcharts hesabından yeniden al (bkz. adım 3).

---

## 1. Gerekli programlar

PowerShell'i (yönetici olması gerekmez) açıp sırayla kur:

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS        # Node 20/22 LTS önerilir (engines: >=18.18)
winget install Spotify.Spotify          # Microsoft Store sürümü DEĞİL, Spicetify onunla çalışmaz
winget install Spicetify.Spicetify      # sonra: spicetify upgrade  (>= 2.45.1 şart)
npm install -g @anthropic-ai/claude-code   # Claude Code ile devam edeceksen
```

Kurulumdan sonra PowerShell'i kapatıp yeniden aç (PATH yenilensin).

Kontrol:

```powershell
git --version; node -v; npm -v; spicetify -v
```

> **Node 24 uyarısı:** Eski PC'de Node 24.17 vardı ve `desktop/` içinde
> `npm install` Electron'u yarım bıraktı (extract-zip takılıyor, hata vermeden
> çıkıyor). LTS sürümünde bu sorun yok. Node 24 kullanırsan çözümü adım 5'te.

> **Spicetify sürümü:** Spotify 1.3.x ile 2.44 çalışmaz (eklenti sessizce
> ölür). En az **2.45.1** olmalı: `spicetify upgrade`.

---

## 2. Projeyi klonla

Klasör yolunu eskisiyle aynı tut. Claude hafızasının klasör adı bu yoldan
türetiliyor (adım 8):

```powershell
mkdir C:\ocean-development
cd C:\ocean-development
git clone https://github.com/oceanyazilim/df-archive.git distro-finder
cd distro-finder
git checkout redesign          # aktif geliştirme dalı (main ile aynı noktada)
```

İstersen eski origin'i de ekle:

```powershell
git remote add desktop https://github.com/oceanyazilim/oceandistrofinder-desktop.git
```

---

## 3. Ortam değişkenleri (`.env.local`)

Eski PC'den getirdiğin `.env.local` dosyasını proje köküne koy. Yoksa iki
seçenek var:

```powershell
# a) Etkileşimli: gizli değerleri ekrana yazmadan .env.local oluşturur
powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1

# b) Elle: şablonu kopyala, değerleri doldur
copy .env.example .env.local
notepad .env.local
```

En önemli değişkenler:

| Değişken | Not |
|---|---|
| `SPOTIFY_CLIENT_ID` / `_SECRET` (+ `_2`, `_3`…) | developer.spotify.com uygulamaları. Yedek slotlar otomatik devreye girer (429/401 failover) |
| `SOUNDCHARTS_CLIENT_ID` / `_SECRET` / `_TEAM_ID` (+ `_2`…`_5`, legacy çiftleri) | Stream/analitik verisi |
| `ADMIN_PASSWORD` | Admin modunu açar (UUID görünürlüğü, sanatçı/playlist analizi, geçmiş) |
| `APP_SECRET` | Rastgele uzun bir değer. `setup-env.ps1` kendisi üretir |
| `OCEAN_LICENSE_SERVER` | Varsayılan `https://distro.virusrecord.com`. Yerel panelle test için `http://127.0.0.1:4000` |

Spotify hesap bağlama (OAuth PKCE) için developer.spotify.com'daki uygulamada
şu Redirect URI kayıtlı olmalı (zaten kayıtlı, sadece yeni bir app açarsan
ekle): `http://127.0.0.1:3000/api/spotify-auth/callback`. `localhost` kabul
edilmiyor, `127.0.0.1` şart. Uygulama Development Mode'da olduğu için
yalnızca User Management'a eklenmiş en fazla 25 hesap bağlanabiliyor.

---

## 4. Web paneli (ana uygulama)

```powershell
npm install
npm test               # core self-test (protobuf decoder, UUID eşleşme, kaynak kontrolleri)
npm run typecheck
npm run dev            # http://127.0.0.1:3000
```

`http://127.0.0.1:3000/api/health` adresi `"status":"ok"` dönmeli.

> Port 3000'i hem `npm run dev` hem masaüstü uygulaması kullanır. Masaüstü
> uygulaması ayaktaki sağlıklı bir dev sunucusunu "adopt" eder, yani ikisi
> birlikte çalışabilir. Ama **`next dev` açıkken `desktop:prepare` / `next build`
> çalıştırma**: `.next` bozulur ve her route 500 döner. Dev'i durdur,
> `.next` klasörünü sil, sonra build al.

---

## 5. Masaüstü uygulaması (Electron)

```powershell
# repo kökünde; npm run dev KAPALI olmalı
npm run desktop:prepare        # next build + desktop/server paketini üretir

cd desktop
npm install                    # electron + electron-builder
npm start                      # uygulamayı açar
```

İlk açılışta `firstRunSetup()` her şeyi kendisi yapar: Spotify kısayollarına
`--remote-debugging-port=9222` bayrağını ekler, Spicetify eklentisini kurar ve
Spotify'ı bağlantılı başlatır. Sonra lisans key'i ile aktive et.

Installer üretmek için:

```powershell
cd C:\ocean-development\distro-finder
npm run desktop:prepare
npm run desktop:dist           # desktop\dist\Ocean Distro Finder Setup 1.0.0.exe
```

**Bilinen sorunlar:**

- *Electron yarım kuruldu (Node 24):* `%LOCALAPPDATA%\electron\Cache` içindeki
  zip'i `Expand-Archive` ile `desktop\node_modules\electron\dist` klasörüne aç,
  sonra `desktop\node_modules\electron\path.txt` dosyasına sadece
  `electron.exe` yaz.
- *`prepare.mjs` EPERM verirse:* `Rename-Item desktop\server server_old`, prepare'i
  tekrar çalıştır, eski klasörü sil.
- *Installer build'inde EPERM (winCodeSign):* `signAndEditExecutable: false`
  zaten ayarlı. Hâlâ olursa Windows Developer Mode'u aç.
- `desktop/server/` otomatik üretilir, elle düzenleme.

---

## 6. Spicetify eklentisi (Spotify içi sağ tık menüsü)

Masaüstü uygulaması bunu kendisi kurar. Elle kurmak/yenilemek için:

```powershell
npm run spicetify:install                                   # json/uuid's.json değişince tekrar çalıştır
node desktop/scripts/install-spicetify.mjs --no-restart     # Spotify'ı yeniden başlatmadan
node desktop/scripts/install-spicetify.mjs --restore        # yamayı tamamen geri al
```

Sonra Spotify'ı CDP bayrağıyla aç:

```powershell
taskkill /IM Spotify.exe /F
& "$env:APPDATA\Spotify\Spotify.exe" --remote-debugging-port=9222 --remote-allow-origins=*
```

Doğrulama: Spotify'da bir şarkıya sağ tıkla. **Ocean Distro Finder** ve
**Analyze with Ocean Analyzer** görünmeli. Test şarkısı `5MH8rf9BdkrFlBEeaYkFZ3`
→ **Believe Digital** dönmeli.

**Spotify bozulursa:** uygulama menüsü → Spotify → *Repair Spotify*. O da
olmazsa `spicetify restore`, o da olmazsa Spotify'ı yeniden kur (çalma
listeleri sunucuda, bir şey kaybolmaz).

---

## 7. Lisans paneli (`license-panel/`)

Canlıda Dokploy'da çalışıyor (`distro.virusrecord.com`), yeni PC'de
bir şey kurmak gerekmiyor. Yerelde geliştirmek için:

```powershell
cd license-panel
npm install
$env:PANEL_PASSWORD="yerel-sifre"; $env:PANEL_SECRET="en-az-16-karakter-rastgele"; $env:DATA_DIR=".\data"
npm run dev                    # http://127.0.0.1:4000
```

Masaüstü uygulamasını yerel panele bağlamak için:
`$env:OCEAN_LICENSE_SERVER="http://127.0.0.1:4000"; npm start` (desktop klasöründe).

Dokploy ayarları (Build path `license-panel`, `/data` volume, env'ler)
`license-panel/README.md` içinde.

---

## 8. Claude Code hafızasını geri yükle

Eski PC'deki Claude hafızası (proje notları, tuzaklar, ölçülmüş API
kısıtları) `docs/claude-memory/` klasöründe. Yeni PC'de Claude'un okuyacağı
yere kopyala:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/restore-claude-memory.ps1
```

Script, proje yolundan klasör adını hesaplayıp
(`C:\ocean-development\distro-finder` → `C--ocean-development-distro-finder`)
dosyaları `%USERPROFILE%\.claude\projects\<ad>\memory\` altına kopyalar.
Mevcut dosyaların üzerine yazmaz.

Sonra:

```powershell
cd C:\ocean-development\distro-finder
claude
```

ve `CLAUDE_PROMPT.md` içindeki prompt'u yapıştır.

---

## 9. Son kontrol listesi

- [ ] `npm test` ve `npm run typecheck` temiz geçiyor
- [ ] `http://127.0.0.1:3000/api/health` → `status: ok`
- [ ] Admin girişi `.env.local`'deki `ADMIN_PASSWORD` ile çalışıyor
- [ ] Settings → API Credentials: Spotify/Soundcharts slotları "available"
- [ ] Masaüstü uygulaması açılıyor, lisans aktive, Settings'te Spotify "Online"
- [ ] Panelde bir Spotify şarkı linki distribütörü buluyor
- [ ] Spotify'da sağ tık → Ocean Distro Finder / Ocean Analyzer çalışıyor
- [ ] Claude hafızası yüklendi (`claude` açılınca MEMORY.md içeriği görünüyor)
