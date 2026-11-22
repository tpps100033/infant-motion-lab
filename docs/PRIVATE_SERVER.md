# 本機資料庫與管理面板

## 啟動

此版本先在研究者電腦執行，GitHub Pages 只部署靜態分析頁。Python 3.12 以上：

```powershell
cd C:\Users\tpps1\source\repos\infant-motion-lab
.\Start-Research.ps1
```

或手動執行：

```powershell
python -m venv server/.venv
server/.venv/Scripts/python.exe -m pip install -r server/requirements.txt
server/.venv/Scripts/python.exe -m server.manage init --write-credentials
server/.venv/Scripts/python.exe -m server.manage serve
```

開啟 http://127.0.0.1:8050/research.html 。預設只監聽 loopback；關閉服務後面板無法存取資料。若要分析影片，需已有 `assets/` 與 `vendor/` 執行資產；缺少時執行 `python scripts/prepare_web.py`。

本次安裝已初始化 `C:\Users\tpps1\AppData\Local\MotionLabResearch`。初次登入帳密在該資料夾的 `initial-login.txt`，不進 Git。登入後由使用者自行在「修改登入密碼」更新，再移除初始帳密檔。重跑 init 不會覆寫既有使用者或資料。研究 IRB 設定預設未核准，正式資料庫沒有預置假個案。

## 面板操作

1. 管理員先登錄核准 IRB 編號、同意版本、計畫結束日期與目標人數。
2. 建立研究員、審閱者帳號；團隊角色適用同一個研究的資料。
3. 用研究代碼收案；不輸入姓名、電話、病歷號、精確生日或簽名。身分對照表與原始書面同意另外保管。
4. 建立每次訪視，登錄當次分組、實足／校正月齡與拍攝檢核。至少連續 3 分鐘影片才符合研究資料納入條件。
5. 點「分析此訪視影片」進工作台，選擇原片並分析，按「保存這次分析到訪視」。也可匯入完整 JSON。原片僅在另行明確上傳時保存。
6. 登錄 Bayley／GMA／MCDI 的既有分數；語音在面板下方分析，確認聲源後歸檔。
7. 由審閱者或管理員確認品質。研究 CSV 排除退出個案與待審閱／拒絕／需重錄的結果。
8. 同一個案有兩次同設定的已審閱分析後，可繪製縱向圖。列印個案頁可由瀏覽器另存 PDF。

## 保存方式與權限

- `research.sqlite3` 保存索引、帳號、工作階段及加密紀錄。研究 payload（個案、訪視、評估、結果、媒體描述與稽核）以 AES-256-GCM 認證加密，每筆使用不同隨機 nonce 與綁定的紀錄 ID。
- 媒體檔在 `files/<opaque-id>.enc`，AES-GCM 加密，保存 SHA256 並在下載時驗證。單檔上限 256 MB；上傳與下載會使用記憶體，伺服器需預留足夠 RAM。
- `master.key` 是唯一解密金鑰，必須另外安全備份。缺少金鑰時程式拒絕默默產生新金鑰覆蓋既有資料。
- SQLite 索引結構、隨機 ID、帳號名稱與密碼雜湊並非完整磁碟加密。研究代碼的唯一索引用 HMAC；個案內容與媒體才是應用層加密。建議搭配電腦磁碟加密與限制 OS 帳號存取。
- 密碼以 scrypt 雜湊；8 小時工作階段、HttpOnly／SameSite Strict Cookie、登入失敗限速、同源請求檢查。遠端設定需 HTTPS，Cookie 才會標記 Secure。
- 管理員可管理 IRB、帳號、備份與稽核；研究員可收案與保存資料；審閱者可讀取結果並審閱，但不能下載原始媒體、上傳或匯出整體研究資料。
- 研究資料不得放到 `assets/`、`vendor/`、GitHub Issue、公開雲端或原始碼。`public/` 使用允許清單封裝，不包含 server、資料庫、金鑰、測試輸出或附件。
- 操作稽核是應用層紀錄，沒有宣稱不可竄改或醫療系統認證；持有伺服器／金鑰的管理者仍可操作資料。

## 備份與搬到伺服器

1. 從管理面板下載「加密備份」，另於不同安全位置備份 `master.key`。
2. 在新電腦安裝程式與 Python 套件，先停止資料庫服務。
3. 將備份中的 `research.sqlite3` 與 `files/` 放到新的空白資料目錄，另外放入同一把 `master.key`。不要與既有資料夾混用。
4. 設定 `MOTIONLAB_DATA_DIR` 或以 `--data-dir` 指定目錄，執行：

```powershell
server/.venv/Scripts/python.exe -m server.manage check --data-dir D:\MotionLabData
server/.venv/Scripts/python.exe -m server.manage serve --data-dir D:\MotionLabData
```

5. 核對個案數、媒體、已審閱分析與使用者。搬遷前撤銷舊工作階段，避免同時使用兩套資料庫。
6. 多人院內部署時由資訊人員設定反向代理、HTTPS、備份輪替與作業系統權限。設定 `MOTIONLAB_ORIGIN=https://實際網域` 並使用 `server.app.create_app` 的 ASGI 工廠部署。此版本不會自動開放防火牆或網際網路連線。

初次安裝於本機的資料夾 ACL 已限制為目前 Windows 使用者。搬遷時需重新設定目的主機權限。金鑰遺失無法復原內容。

## 退出與期限

退出後停止新增訪視、媒體與結果，研究 CSV 排除個案。管理員依研究核准程序登錄原因後，才可在退出個案頁輸入完整代碼永久清除本機紀錄與媒體；稽核保留不含臨床 payload 的操作 ID。SQLite 舊頁、OS 快照與已下載備份不能靠這個操作保證物理抹除，須依院方保存／銷毀程序一併處理。

計畫要求保存期限不超過計畫結束後五年；面板顯示最晚期限，不會自行推定較長保存時間或無提示刪除資料。

## 驗證

```powershell
server/.venv/Scripts/python.exe -m pip install pytest httpx
server/.venv/Scripts/python.exe -m pytest tests/test_private_api.py -q
node --test tests/*.test.mjs
python scripts/check_static.py
```

測試使用臨時目錄與假研究代碼，不對正式受試者資料庫寫入。`server/requirements-lock.txt` 記錄本次 Windows 驗證環境；正式依賴需求見 `server/requirements.txt`。
