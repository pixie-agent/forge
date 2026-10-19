/**
 * 平台自带的 UI 组件库(唯一入口)。绝大多数场景都从这里 import:
 *
 *   import { Button, Card, CardHeader, CardBody, Input, Tabs, Badge, Stat, StatGrid,
 *            Section, SectionTitle, EmptyState, ErrorState, SkeletonCard, Modal, useToast,
 *            Reveal, Icon } from './components/ui/index.js'
 *
 * 约定:这些文件由平台维护,不要改它们;需要新样式请在页面里用 Tailwind 组合,或改 tokens.css 的品牌色。
 * 完整清单见本文件导出,以及 src/styles/theme.css 顶部列出的语义类名。
 */
export { Button, IconButton } from './Button.jsx'
export { Card, CardHeader, CardBody, CardFooter } from './Card.jsx'
export { Field, Input, Textarea, Select, Switch } from './Field.jsx'
export { Modal, ConfirmDialog } from './Modal.jsx'
export { Tabs, SegmentedControl } from './Tabs.jsx'
export { ToastProvider, useToast } from './Toast.jsx'
export {
  Spinner,
  Skeleton,
  SkeletonText,
  SkeletonCard,
  LoadingBlock,
  EmptyState,
  ErrorState,
} from './Feedback.jsx'
export { Container, Section, SectionTitle, Stat, StatGrid, Badge } from './Layout.jsx'
export { Icon, ICON_NAMES } from './Icon.jsx'
export { Reveal, Stagger, StaggerItem } from './Reveal.jsx'
