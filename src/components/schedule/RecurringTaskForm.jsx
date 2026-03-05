import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

export default function RecurringTaskForm({ formData, setFormData }) {
  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex items-center gap-2">
        <Checkbox
          id="recurring"
          checked={Boolean(formData.is_recurring)}
          onCheckedChange={(checked) => 
            setFormData({ 
              ...formData, 
              is_recurring: Boolean(checked),
              recurrence_pattern: checked ? formData.recurrence_pattern || 'weekly' : undefined,
              recurrence_end_date: checked ? formData.recurrence_end_date : undefined
            })
          }
        />
        <Label htmlFor="recurring" className="cursor-pointer">
          Make this a recurring task
        </Label>
      </div>

      {formData.is_recurring && (
        <div className="space-y-4 ml-6 border-l-2 border-purple-200 pl-4">
          <div className="space-y-2">
            <Label>Recurrence Pattern</Label>
            <Select
              value={formData.recurrence_pattern || "weekly"}
              onValueChange={(value) => setFormData({ ...formData, recurrence_pattern: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Every 2 Weeks</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>End Date (Optional)</Label>
            <Input
              type="date"
              value={formData.recurrence_end_date || ""}
              onChange={(e) => setFormData({ ...formData, recurrence_end_date: e.target.value })}
            />
            <p className="text-xs text-gray-500">Leave empty for indefinite recurrence</p>
          </div>
        </div>
      )}
    </div>
  );
}
