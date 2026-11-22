# 參與開發

歡迎以 Issue 描述問題，或以 Pull Request 提出改進。請先用內建公開影片或合成示範重現問題，附上瀏覽器版本、操作步驟、預期結果與實際結果。

## 開發環境

網站使用原生 HTML / CSS / JavaScript，沒有需要安裝的 npm 依賴。Node.js 20 以上用於測試，Python 3.12 用於模型資產準備與本機預覽。

```sh
git clone https://github.com/tpps100033/infant-motion-lab.git
cd infant-motion-lab
python scripts/prepare_web.py
node --test tests/*.test.mjs
python scripts/check_static.py
python scripts/serve.py
```

開啟 http://127.0.0.1:8080 。模型分塊與 WASM 執行檔由準備腳本下載，未納入 Git 版本控制。

## 提交前檢查

- 執行 Node 測試與靜態資產檢查。
- 檢查信心優先與判定率優先模式，確認一次只有一項可手動調整。
- 修改動作指標定義時，同步更新方法說明、測試與 `CHANGELOG.md`。
- Pull Request 說明應包含具體行為變化及驗證方式。

## 授權

提交自行撰寫的程式碼時，請確認你有權以本專案的 MIT 許可證提供該貢獻。第三方模型、套件與資料集的原始授權仍各自適用，詳見 `NOTICE.txt`。
