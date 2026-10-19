import {
  Search, Plus, Minus, X, Check, CheckCheck, Trash2, Trash, PenLine, Filter,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowRight, ArrowLeft, ArrowUpRight, ArrowUpDown,
  Menu, Home, ExternalLink, Copy, RefreshCw, RotateCcw, SlidersHorizontal,
  Info, CheckCircle2, XCircle, AlertTriangle, CircleHelp, Loader2,
  Heart, Star, Bookmark, Image, ImagePlus, Camera, Play, Pause, Music, Video, Headphones,
  FileText, File, Files, Inbox, Mail, MessageCircle, MessageSquare, ThumbsUp, Send,
  Tag, ShoppingCart, CreditCard, Package, Briefcase, Award, Wallet, Receipt, Truck, Gift,
  User, Users, UserPlus, Phone, Smile, Crown, Trophy, Medal,
  Settings, Lock, Unlock, Eye, EyeOff, Bell, Calendar, Clock, Upload, Download, Share2,
  Link, Link2, Globe, Database, Server, Cloud, Cpu, Terminal, Code, Code2,
  BarChart3, PieChart, TrendingUp, Activity, Percent, Calculator, Hash,
  Layers, LayoutGrid, List, Clipboard, ClipboardList, Sparkles, Zap, Target, Wrench, Palette, Type, AlignLeft,
  MapPin, Map, Compass, Flag, ShieldCheck, Rocket, FolderOpen, Folder, Megaphone, Quote,
  Sun, Moon, Sunrise, Sunset, Flame, Snowflake, Droplet, Leaf, TreePine, Waves, Book, BookOpen, GraduationCap, Newspaper,
} from 'lucide-react'

/**
 * 图标:统一入口 `<Icon name="Search" />`(24×24 线性图标,颜色跟随文字,尺寸默认 20)。
 *
 * 用法:<Icon name="Trash2" size={16} className="text-danger" />
 * 名字写错不会报错,会渲染成兜底问号图标 —— 但请务必用下面的名字。
 * 命名规则:大驼峰,数字后缀表示图标数量(如 Plus / Trash2 / ChevronDown / BarChart3)。
 */
const MAP = {
  Search, Plus, Minus, X, Check, CheckCheck, Trash2, Trash, PenLine, Filter,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowRight, ArrowLeft, ArrowUpRight, ArrowUpDown,
  Menu, Home, ExternalLink, Copy, RefreshCw, RotateCcw, SlidersHorizontal,
  Info, CheckCircle2, XCircle, AlertTriangle, CircleHelp, Loader2,
  Heart, Star, Bookmark, Image, ImagePlus, Camera, Play, Pause, Music, Video, Headphones,
  FileText, File, Files, Inbox, Mail, MessageCircle, MessageSquare, ThumbsUp, Send,
  Tag, ShoppingCart, CreditCard, Package, Briefcase, Award, Wallet, Receipt, Truck, Gift,
  User, Users, UserPlus, Phone, Smile, Crown, Trophy, Medal,
  Settings, Lock, Unlock, Eye, EyeOff, Bell, Calendar, Clock, Upload, Download, Share2,
  Link, Link2, Globe, Database, Server, Cloud, Cpu, Terminal, Code, Code2,
  BarChart3, PieChart, TrendingUp, Activity, Percent, Calculator, Hash,
  Layers, LayoutGrid, List, Clipboard, ClipboardList, Sparkles, Zap, Target, Wrench, Palette, Type, AlignLeft,
  MapPin, Map, Compass, Flag, ShieldCheck, Rocket, FolderOpen, Folder, Megaphone, Quote,
  Sun, Moon, Sunrise, Sunset, Flame, Snowflake, Droplet, Leaf, TreePine, Waves, Book, BookOpen, GraduationCap, Newspaper,
}

/** 可用图标名清单(prompt 与自查都用它) */
export const ICON_NAMES = Object.keys(MAP).sort()

export function Icon({ name, size = 20, strokeWidth = 1.75, className = '', title, ...rest }) {
  const Cmp = MAP[name] ?? CircleHelp
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={title ? undefined : true}
      {...(title ? { role: 'img', 'aria-label': title } : {})}
      {...rest}
    />
  )
}
