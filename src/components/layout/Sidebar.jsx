import { Link, useLocation } from "react-router-dom"
import {
  Home,
  CloudSun,
  Stethoscope,
  LineChart,
  Users,
  User,
  Shield,
} from "lucide-react"

const menu = [
  { name: "Home", path: "/", icon: Home },
  { name: "Weather", path: "/weather", icon: CloudSun },
  { name: "Diagnose", path: "/diagnose", icon: Stethoscope },
  { name: "Predictions", path: "/predictions", icon: LineChart },
  { name: "Community", path: "/community", icon: Users },
  { name: "Profile", path: "/profile", icon: User },
  { name: "Admin", path: "/admin", icon: Shield },
]

export default function Sidebar() {
  const location = useLocation()

  return (
    <div className="h-screen w-64 bg-black text-white p-5">
      <h1 className="mb-8 text-xl font-bold">Aerovanta</h1>

      <nav className="space-y-2">
        {menu.map((item) => {
          const Icon = item.icon
          const active = location.pathname === item.path

          return (
            <Link
              key={item.name}
              to={item.path}
              className={`flex items-center gap-3 rounded-lg p-3 transition ${
                active
                  ? "bg-green-600"
                  : "hover:bg-gray-800"
              }`}
            >
              <Icon size={18} />
              {item.name}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
