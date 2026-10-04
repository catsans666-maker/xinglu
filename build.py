# 把 core.js、gmap.js、ui.js 塞進 template.html → index.html（UTF-8 讀寫，Windows 也不會亂碼）
t = open('template.html', encoding='utf-8').read()
for k, f in (('/*CORE*/', 'core.js'), ('/*GMAP*/', 'gmap.js'), ('/*UI*/', 'ui.js')):
    t = t.replace(k, open(f, encoding='utf-8').read())
open('index.html', 'w', encoding='utf-8').write(t)
print(len(t))
