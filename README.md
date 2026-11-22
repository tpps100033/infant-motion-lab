# Motion Lab：嬰幼兒動作分析

[![Publish Motion Lab](https://github.com/tpps100033/infant-motion-lab/actions/workflows/pages.yml/badge.svg)](https://github.com/tpps100033/infant-motion-lab/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-0c827c)](https://tpps100033.github.io/infant-motion-lab/)

可部署至 GitHub Pages 的 HTML / CSS / JavaScript 研究原型。RTMPose-M 在瀏覽器內執行；公開分析頁可獨立使用。受試者管理另有本機 Python / SQLite 私人服務。

網站：https://tpps100033.github.io/infant-motion-lab/

## 功能

- 本機影片載入、固定人物範圍框選與 COCO 17 點姿態估計。
- 關節疊圖播放、時間軸及逐關節軌跡。
- 動作速度、位置變異度、jerk 平滑度、幅度及左右對稱性。
- 短缺口補值、分段平滑、軀幹座標正規化與資料品質檢查。
- 信心門檻／目標判定率互斥設定，變更後直接用原始關節分數重算，無須再次推論。
- 完整 JSON、逐幀 CSV、特徵 CSV 與雙側 CSV 匯出及結果重新匯入。
- 合成資料示範，另可按鈕載入 BabyPose 的 11 秒全身踢腿影片，預設分析全片。

公開分析頁的影片與座標留在瀏覽器記憶體。私人資料庫另提供明確操作的歸檔與媒體上傳；不會自動保存原片。公開範例從 BabyPose 專案下載，關閉網頁前請下載或歸檔結果。

## 操作

1. 開啟網站，選擇影片或按「載入 11 秒全身範例」。此範例呈現頭部、軀幹、雙手與雙腳。
2. 拖曳框選嬰幼兒的完整活動範圍，避免照顧者進入範圍。
3. 設定取樣頻率、分析長度，選擇手動信心門檻或目標判定率，按「開始分析」。首次載入約 54 MB 模型。
4. 檢視軌跡、五項指標與左右差異，下載 JSON 或 CSV。

## 部署與本機預覽

GitHub **Settings → Pages → Source → GitHub Actions**。推送至 `main` 後，`Publish Motion Lab` 會下載固定版本的 ONNX Runtime Web 與 RTMPose-M、驗證模型雜湊，再將 `public/` 發佈至 GitHub Pages。

Git 儲存庫只追蹤程式碼、授權與模型清單，不追蹤大型模型分塊或個案資料。模型在部署時建立，沒有使用 Git LFS。

```sh
python scripts/prepare_web.py
node --test tests/*.test.mjs
python scripts/check_static.py
python scripts/serve.py
```

預覽：http://127.0.0.1:8080 。瀏覽器需要 HTTPS 或 localhost，不能直接以 `file://` 開啟。

## 驗證與界線

已在瀏覽器完成公開嬰兒短片的 63 影格推論與指標輸出。JavaScript 指標計算已與原 Python 管線在正弦、靜止、缺口、非均勻時間戳及分窗案例比對，模型前處理也與 OpenCV 5.1 比對。

本原型輸出二維研究量測，尚無月齡常模或臨床診斷效度。公開短片未提供人工關節真值，因此沒有宣稱已量測嬰幼兒 AP、PCK 或診斷準確度。網頁採單人固定 ROI，沒有自動年齡辨識或 YOLOX 追蹤；速度依瀏覽器與裝置而定。

完整方法、格式與限制見 [DEPLOY.md](DEPLOY.md)，第三方授權見 [NOTICE.txt](NOTICE.txt)。

## 信心門檻與判定率

兩種模式一次只允許一個手動設定：設定信心門檻時，判定率自動計算；設定目標判定率時，系統依關節分數分布反推信心門檻。判定率為「座標有效且分數通過門檻的關節點數 ÷（全部影格數 × 17 點）」，在程式中以 `passed / (frames * 17)` 計算，不是對人工標註的準確率。缺失點仍計入分母。

同分關節無法分開通過，目標比例可能無法精確達到，介面會顯示實際比例及通過點數。完整 JSON 保存模式、目標、實際比例、門檻與計數；CSV 也附上使用的門檻及判定率。高門檻導致肩髖不足時，保留原始結果，暫停輸出動作指標。

## 授權與參與

本專案原創程式碼採用 [MIT License](LICENSE)。RTMPose 模型、ONNX Runtime Web 與公開示範影片各依原來源條款，請參閱 [NOTICE.txt](NOTICE.txt)。MIT 不改變第三方資產的授權。

問題回報請使用 [GitHub Issues](https://github.com/tpps100033/infant-motion-lab/issues/new/choose)。參與方式見 [CONTRIBUTING.md](CONTRIBUTING.md)，版本變更見 [CHANGELOG.md](CHANGELOG.md)。

範例建議信心門檻為 20%（載入時自動設定）。桌面版相同模型全幀驗證：270 影格、4,590 個關節點，40% 門檻通過 96.34%，20% 門檻通過 100%。此比例表示分數通過門檻，不表示座標與人工真值完全一致；瀏覽器解碼取樣可能略有差異。


## 研究資料庫面板（v0.4）

已新增 [研究資料管理入口](https://tpps100033.github.io/infant-motion-lab/research.html)。正式個案使用本機私人網址 http://127.0.0.1:8050/research.html ，以 `Start-Research.ps1` 啟動。資料、金鑰與帳密位於 Windows 使用者的 AppData，不納入 Git 或 GitHub Pages。

- 收案、監護人同意版本、每月訪視、實足／校正月齡、動態分組與臨床量表結果。
- 原始影片／語音加密保存、分析版本歸檔、審閱與操作稽核。
- 個體縱向追蹤、研究 CSV、個案列印報告、加密備份與伺服器搬遷。
- 語音高通、能量端點候選、音高中位數／IQR、節律描述與人工聲源標籤。
- 多影片分析佇列、速度與加速度曲線、依關節及視窗篩選擴充指標。

動作特徵已增加速度分布、加速度、方向幅度與變異、路徑長度、位移、直線度、無因次平方 jerk、六組肢體協調性、肘膝二維角度。指標版本為 **schema 2.0**；舊資料有 raw tracks 時可以重算。

[安裝與管理](docs/PRIVATE_SERVER.md) · [計畫需求對照](docs/REQUIREMENTS.md) · [指標方法](docs/METHODS.md) · [公開資料測試](docs/DATASET_TESTS.md)

研究資料匯出需人工審閱，動作影片須符合至少連續 3 分鐘與拍攝檢核。公開 11 秒範例僅供操作測試。語音聲源與音節類別需人工確認；尚無訓練完成的跨模態疾病預測模型或月齡常模。
