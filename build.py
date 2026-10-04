# 把 core.js、ui.js 塞進 template.html → index.html（UTF-8 讀寫，Windows 也不會亂碼）
t = open('template.html', encoding='utf-8').read()
t = t.replace('/*CORE*/', open('core.js', encoding='utf-8').read()).replace('/*UI*/', open('ui.js', encoding='utf-8').read())
open('index.html', 'w', encoding='utf-8').write(t)
print(len(t))
