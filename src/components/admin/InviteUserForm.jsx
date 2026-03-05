import { useState } from "react";
import { appClient } from "@/api/appClient";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Loader2, Mail, CheckCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function InviteUserForm({ onClose }) {
  const [email, setEmail] = useState("");
  const [invitedEmail, setInvitedEmail] = useState("");
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const queryClient = useQueryClient();

  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

  const inviteMutation = useMutation({
    mutationFn: async (targetEmail) => {
      setErrorMessage("");
      await appClient.users.inviteUser(targetEmail);
    },
    onSuccess: (_result, targetEmail) => {
      setSuccess(true);
      setInvitedEmail(targetEmail);
      queryClient.invalidateQueries({ queryKey: ["all-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-auth-events"] });
      setTimeout(() => {
        onClose();
      }, 2000);
    },
    onError: (error) => {
      setErrorMessage(error?.message || "Failed to send invitation. Please try again.");
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      setErrorMessage("Enter a valid email address before sending the invite.");
      return;
    }
    setEmail(normalizedEmail);
    inviteMutation.mutate(normalizedEmail);
  };

  return (
    <Card className="border-none shadow-xl">
      <CardHeader className="border-b bg-gradient-to-r from-violet-50 to-purple-100/80">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-violet-600" />
            Invite New User
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {success ? (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Invitation sent successfully to {invitedEmail || "the selected user"}.
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email Address *</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errorMessage) setErrorMessage("");
                }}
                placeholder="user@example.com"
                required
                disabled={inviteMutation.isPending}
              />
            </div>

            {inviteMutation.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {errorMessage}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={inviteMutation.isPending}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={inviteMutation.isPending}
                className="flex-1 bg-violet-600 hover:bg-violet-700"
              >
                {inviteMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send Invitation"
                )}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
