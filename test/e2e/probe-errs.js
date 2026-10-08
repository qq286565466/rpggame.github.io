/* 截图用探针：只回报页面错误数，避免命令行里出现 shell 元字符 */
JSON.stringify({ errs: (window.__errs || []).length })
