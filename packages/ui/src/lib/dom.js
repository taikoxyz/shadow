export function el(tag, props = {}, children = []) {
  const elem = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;

    if (key === 'className') {
      elem.className = value;
      continue;
    }

    if (key === 'style' && typeof value === 'string') {
      elem.style.cssText = value;
      continue;
    }

    if (key.startsWith('on') && typeof value === 'function') {
      elem.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }

    if (key === 'download' && value === true) {
      elem.setAttribute('download', '');
      continue;
    }

    if (key in elem) {
      elem[key] = value;
      continue;
    }

    elem.setAttribute(key, value === true ? '' : String(value));
  }

  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    if (child instanceof Node) {
      elem.appendChild(child);
      continue;
    }
    elem.appendChild(document.createTextNode(String(child)));
  }

  return elem;
}
