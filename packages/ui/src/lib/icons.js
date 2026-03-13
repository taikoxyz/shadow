import {
  createElement,
  Eye,
  Settings,
  Sun,
  Moon,
  FileKey,
  ArrowDownToLine,
  X,
  RefreshCcw,
} from 'lucide';

function lucideIcon(iconNode, extraClass) {
  const icon = createElement(iconNode, { width: 15, height: 15, 'stroke-width': 1.5 });
  icon.setAttribute('aria-hidden', 'true');
  if (extraClass) icon.classList.add(extraClass);
  return icon;
}

export const eyeIcon = () => lucideIcon(Eye);
export const settingsIcon = () => lucideIcon(Settings);
export const sunIcon = () => lucideIcon(Sun);
export const moonIcon = () => lucideIcon(Moon);
export const depositFileIcon = () => lucideIcon(FileKey, 'deposit-file-icon');
export const downloadIcon = () => lucideIcon(ArrowDownToLine);
export const deleteIcon = () => lucideIcon(X);
export const refreshIcon = () => lucideIcon(RefreshCcw);
