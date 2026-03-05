import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, User, Calendar, Mail, Ban, UserRoundCog } from "lucide-react";

export default function UserList({
  users,
  currentUser,
  onToggleRole,
  onToggleStatus,
  updatingUserId,
  isUpdating,
}) {
  const getRoleBadge = (role) => {
    if (role === "admin") {
      return (
        <Badge className="bg-purple-100 text-purple-800 gap-1">
          <Shield className="w-3 h-3" />
          Admin
        </Badge>
      );
    }
      return (
        <Badge className="bg-violet-100 text-violet-800 gap-1">
          <User className="w-3 h-3" />
          User
        </Badge>
    );
  };

  const getStatusBadge = (status) => {
    if (status === "suspended") return <Badge className="bg-red-100 text-red-800">Suspended</Badge>;
    if (status === "invited") return <Badge className="bg-amber-100 text-amber-800">Invited</Badge>;
    return <Badge className="bg-emerald-100 text-emerald-800">Active</Badge>;
  };

  if (users.length === 0) {
    return (
      <div className="text-center py-12">
        <User className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-600">No users found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {users.map((user) => {
        const isCurrentUser = user.id === currentUser?.id;
        const canEdit = !isCurrentUser;
        const rowUpdating = isUpdating && updatingUserId === user.id;

        return (
          <div
            key={user.id}
            className={`p-4 rounded-lg border ${
              isCurrentUser ? "bg-violet-50 border-violet-200" : "bg-white/70 border-white/70 backdrop-blur-lg"
            } hover:shadow-md transition-shadow`}
          >
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center text-white font-bold text-lg">
                  {user.full_name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{user.full_name || "Unnamed User"}</h3>
                    {isCurrentUser ? <Badge variant="outline" className="text-xs">You</Badge> : null}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600 mt-1 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      {user.email}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Joined {new Date(user.created_date).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {getRoleBadge(user.role)}
                {getStatusBadge(user.account_status)}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onToggleRole?.(user)}
                disabled={!canEdit || rowUpdating}
                className="gap-1"
              >
                <UserRoundCog className="w-4 h-4" />
                {user.role === "admin" ? "Set as User" : "Set as Admin"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onToggleStatus?.(user)}
                disabled={!canEdit || rowUpdating}
                className="gap-1"
              >
                <Ban className="w-4 h-4" />
                {user.account_status === "suspended" ? "Re-activate" : "Suspend"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
