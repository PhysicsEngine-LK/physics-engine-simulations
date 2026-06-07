import re

file_path = r'd:\Lisitha\Physics\physics-engine-simulations\GameChangerJune\index.html'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove back-btn
content = re.sub(r'      <a href="\.\./index\.html" class="back-btn">.*?</a>\n', '', content, flags=re.DOTALL)

# 2. Comment out SYS-07 and onwards
parts = content.split('<article class="sim-card">')

new_parts = [parts[0]]
for part in parts[1:]:
    # find SYS ID
    match = re.search(r'<span class="sim-id">SYS-(\d+)</span>', part)
    if match:
        sys_id = int(match.group(1))
        if sys_id > 5:
            new_parts.append('<!-- <article class="sim-card">' + part.replace('</article>', '</article> -->'))
        else:
            new_parts.append('<article class="sim-card">' + part)
    else:
        new_parts.append('<article class="sim-card">' + part)

new_content = ''.join(new_parts)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(new_content)
