import './admin.css'
import { splitPath } from './format'
import { AppShell } from './components/shell'
import { CommandCenterPage } from './pages/CommandCenter'
import { MyWorkPage } from './pages/MyWork'
import { RestaurantsOverviewPage } from './pages/Restaurants'
import { OrderDetailPage } from './pages/OrderDetail'
import { PartiesListPage, PartyDetailPage } from './pages/Parties'

/** The admin console. Mounted by App.tsx for the console paths only (see nav.isConsolePath). */
export default function AdminApp({ path }: { path: string }) {
  const { pathname } = splitPath(path)
  let page
  let m: RegExpMatchArray | null
  if (pathname === '/admin') page = <CommandCenterPage />
  else if (pathname === '/admin/work') page = <MyWorkPage path={path} />
  else if (pathname === '/admin/parties') page = <PartiesListPage />
  else if ((m = pathname.match(/^\/admin\/parties\/([^/]+)$/))) page = <PartyDetailPage key={m[1]} id={decodeURIComponent(m[1])} />
  else if (pathname === '/admin/sr/restaurants') page = <RestaurantsOverviewPage />
  else if ((m = pathname.match(/^\/admin\/sr\/restaurants\/orders\/([^/]+)$/))) page = <OrderDetailPage key={m[1]} id={decodeURIComponent(m[1])} />
  else page = null
  return <AppShell path={path}>{page}</AppShell>
}
