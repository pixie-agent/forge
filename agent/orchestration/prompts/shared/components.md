平台组件库(必须用,不要自己重造;统一从 './components/ui/index.js' 一个入口 import):
  import { Button, IconButton, Card, CardHeader, CardBody, CardFooter, Field, Input, Textarea, Select, Switch,
           Modal, ConfirmDialog, Tabs, SegmentedControl, ToastProvider, useToast,
           Spinner, Skeleton, SkeletonText, SkeletonCard, LoadingBlock, EmptyState, ErrorState,
           Container, Section, SectionTitle, Stat, StatGrid, Badge, Icon, ICON_NAMES,
           Reveal, Stagger, StaggerItem } from './components/ui/index.js'

  · <Button variant="primary|secondary|outline|ghost|danger|link" size="sm|md|lg" loading full icon iconRight>文字</Button>
      —— 所有交互态(hover/active/focus-visible/disabled/loading)已内置;<IconButton label="…"> 用于纯图标按钮(必须给 label)。
  · <Card hover padding="md|lg|none"> / <CardHeader title subtitle action> / <CardBody> / <CardFooter> —— 承载页面每一块内容,不要写裸 div 拼边框。
  · <Input label hint error required … /> / <Textarea> / <Select options={[{value,label}]}> / <Switch checked onChange> / <Field label hint error>
      —— label、错误文案、aria-* 自动关联;校验失败传 error 即可。
  · <Modal open onClose title description size footer> / <ConfirmDialog open title description onConfirm onClose tone="danger|primary">
      —— 删除等破坏性操作**必须**走 ConfirmDialog;ESC/点遮罩/锁滚动已内置。
  · <Tabs items={[{key,label,icon,content}]} value onChange /> / <SegmentedControl items value onChange /> —— 同页多视图。
  · <ToastProvider> 包在根组件外层;<ToastProvider> 内的组件用 const toast = useToast() 调 toast.success/error/info/dismiss。
      —— 提交成功/失败必须给一次 Toast 反馈。
  · 三态:<SkeletonCard> / <SkeletonText lines> / <Skeleton className="h-4 w-32"> / <LoadingBlock label> /
         <EmptyState icon title description action> / <ErrorState title description onRetry>
      —— 任何异步区域必须三态齐全:loading → 骨架;空 → EmptyState(带下一步动作);失败 → ErrorState(带 onRetry)。
  · 版式:<Section id tinted> / <Container width="default|narrow|wide"> / <SectionTitle eyebrow title description align="left|center"> /
         <Stat label value text hint icon> / <StatGrid cols={2|3|4}> / <Badge tone="neutral|brand|success|warning|danger">
  · <Icon name="Search" size={20} /> —— 图标名必须用大驼峰字符串(如 Plus / Trash2 / ChevronDown / BarChart3 / Sparkles / Users)。
      可用名字见 Icon.jsx 的 ICON_NAMES;写错会渲染成问号。**不要引入任何图标库**。
  · <Reveal delay y> / <Stagger gap> / <StaggerItem> —— 进场动效。
  组件不传 props 也能渲染出合格样式:优先"少参数直接用",不要为了微调把类名堆到组件上。
