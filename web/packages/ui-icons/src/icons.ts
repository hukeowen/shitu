import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Ban,
  Banknote,
  Bell,
  BookOpen,
  Briefcase,
  BuildingComplex,
  Calculator,
  Calendar,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleExclamationPoint,
  CircleX,
  ClipboardList,
  Clock,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  Factory,
  FilePenLine,
  FileText,
  Headset,
  House,
  IdCard,
  Inbox,
  Info,
  LayoutDashboard,
  ListFilter,
  Lock,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Minus,
  Pencil,
  Phone,
  Plus,
  QrCode,
  Receipt,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash,
  TrendingUp,
  TriangleExclamationPoint,
  Upload,
  User,
  UserCheck,
  Users,
  Wallet,
  X,
} from '@lucide/vue'
import { shituIcon } from './shituIcon'

/**
 * 仕兔图标清单。名字是 Icon + Lucide 的正式图标名（不用别名，别名升级时可能被移除）。
 * 要用清单外的图标：在这里按同样写法加一行，不要在应用里直接引 @lucide/vue 或手写 SVG。
 * 每行的 PURE 标记不能少：有它，没被引用的图标才不会进构建产物。
 */

// 导航与箭头
export const IconArrowLeft = /*#__PURE__*/ shituIcon(ArrowLeft)
export const IconArrowRight = /*#__PURE__*/ shituIcon(ArrowRight)
export const IconChevronDown = /*#__PURE__*/ shituIcon(ChevronDown)
export const IconChevronLeft = /*#__PURE__*/ shituIcon(ChevronLeft)
export const IconChevronRight = /*#__PURE__*/ shituIcon(ChevronRight)
export const IconChevronUp = /*#__PURE__*/ shituIcon(ChevronUp)
export const IconEllipsis = /*#__PURE__*/ shituIcon(Ellipsis)
export const IconExternalLink = /*#__PURE__*/ shituIcon(ExternalLink)
export const IconMenu = /*#__PURE__*/ shituIcon(Menu)
export const IconX = /*#__PURE__*/ shituIcon(X)

// 底部标签栏与入口
export const IconHouse = /*#__PURE__*/ shituIcon(House)
export const IconClipboardList = /*#__PURE__*/ shituIcon(ClipboardList)
export const IconMessageSquare = /*#__PURE__*/ shituIcon(MessageSquare)
export const IconUser = /*#__PURE__*/ shituIcon(User)
export const IconBriefcase = /*#__PURE__*/ shituIcon(Briefcase)
export const IconSparkles = /*#__PURE__*/ shituIcon(Sparkles)
export const IconWallet = /*#__PURE__*/ shituIcon(Wallet)
export const IconFilePenLine = /*#__PURE__*/ shituIcon(FilePenLine)
export const IconLayoutDashboard = /*#__PURE__*/ shituIcon(LayoutDashboard)

// 状态与提示
export const IconCircleCheck = /*#__PURE__*/ shituIcon(CircleCheck)
export const IconCircleX = /*#__PURE__*/ shituIcon(CircleX)
export const IconCircleExclamationPoint = /*#__PURE__*/ shituIcon(CircleExclamationPoint)
export const IconTriangleExclamationPoint = /*#__PURE__*/ shituIcon(TriangleExclamationPoint)
export const IconInfo = /*#__PURE__*/ shituIcon(Info)
export const IconClock = /*#__PURE__*/ shituIcon(Clock)
export const IconInbox = /*#__PURE__*/ shituIcon(Inbox)
export const IconShieldCheck = /*#__PURE__*/ shituIcon(ShieldCheck)
export const IconLock = /*#__PURE__*/ shituIcon(Lock)
export const IconBan = /*#__PURE__*/ shituIcon(Ban)

// 操作
export const IconSearch = /*#__PURE__*/ shituIcon(Search)
export const IconPlus = /*#__PURE__*/ shituIcon(Plus)
export const IconMinus = /*#__PURE__*/ shituIcon(Minus)
export const IconCheck = /*#__PURE__*/ shituIcon(Check)
export const IconPencil = /*#__PURE__*/ shituIcon(Pencil)
export const IconTrash = /*#__PURE__*/ shituIcon(Trash)
export const IconCopy = /*#__PURE__*/ shituIcon(Copy)
export const IconDownload = /*#__PURE__*/ shituIcon(Download)
export const IconUpload = /*#__PURE__*/ shituIcon(Upload)
export const IconRefreshCw = /*#__PURE__*/ shituIcon(RefreshCw)
export const IconListFilter = /*#__PURE__*/ shituIcon(ListFilter)
export const IconEye = /*#__PURE__*/ shituIcon(Eye)
export const IconEyeOff = /*#__PURE__*/ shituIcon(EyeOff)
export const IconPhone = /*#__PURE__*/ shituIcon(Phone)
export const IconShare2 = /*#__PURE__*/ shituIcon(Share2)
export const IconQrCode = /*#__PURE__*/ shituIcon(QrCode)
export const IconScanLine = /*#__PURE__*/ shituIcon(ScanLine)
export const IconLogOut = /*#__PURE__*/ shituIcon(LogOut)
export const IconSettings = /*#__PURE__*/ shituIcon(Settings)

// 业务对象
export const IconBell = /*#__PURE__*/ shituIcon(Bell)
export const IconBuildingComplex = /*#__PURE__*/ shituIcon(BuildingComplex)
export const IconCalendar = /*#__PURE__*/ shituIcon(Calendar)
export const IconFileText = /*#__PURE__*/ shituIcon(FileText)
export const IconIdCard = /*#__PURE__*/ shituIcon(IdCard)
export const IconMapPin = /*#__PURE__*/ shituIcon(MapPin)
export const IconUsers = /*#__PURE__*/ shituIcon(Users)
export const IconUserCheck = /*#__PURE__*/ shituIcon(UserCheck)
export const IconBanknote = /*#__PURE__*/ shituIcon(Banknote)
export const IconReceipt = /*#__PURE__*/ shituIcon(Receipt)
export const IconBookOpen = /*#__PURE__*/ shituIcon(BookOpen)
export const IconChartColumn = /*#__PURE__*/ shituIcon(ChartColumn)
export const IconHeadset = /*#__PURE__*/ shituIcon(Headset)
export const IconFactory = /*#__PURE__*/ shituIcon(Factory)
// 企业后台侧栏（工单 14）
export const IconArrowLeftRight = /*#__PURE__*/ shituIcon(ArrowLeftRight)
export const IconCalculator = /*#__PURE__*/ shituIcon(Calculator)
export const IconTrendingUp = /*#__PURE__*/ shituIcon(TrendingUp)
