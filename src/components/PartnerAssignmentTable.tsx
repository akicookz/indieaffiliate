import { useState } from "react";
import { Check, Plus, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ReferralCodeGroup {
  code: string;
  matchedPartnerId: string | null;
  matchedPartnerName: string | null;
  subscriptionCount: number;
  totalRevenue: number;
}

interface ExistingPartner {
  id: string;
  name: string;
  email: string;
  referralCode: string;
}

interface Assignment {
  referralCode: string;
  partnerId: string;
  action: "link" | "skip";
}

interface NewPartnerForm {
  name: string;
  email: string;
  commissionRate: number;
}

interface PartnerAssignmentTableProps {
  referralCodes: ReferralCodeGroup[];
  existingPartners: ExistingPartner[];
  assignments: Assignment[];
  onAssignmentsChange: (assignments: Assignment[]) => void;
  onCreatePartner: (form: NewPartnerForm, referralCode: string) => Promise<string | null>;
  creatingPartner: boolean;
}

function PartnerAssignmentTable({
  referralCodes,
  existingPartners,
  assignments,
  onAssignmentsChange,
  onCreatePartner,
  creatingPartner,
}: PartnerAssignmentTableProps) {
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [newPartnerForm, setNewPartnerForm] = useState<NewPartnerForm>({
    name: "",
    email: "",
    commissionRate: 0.2,
  });

  const assignmentMap = new Map(assignments.map((a) => [a.referralCode.toUpperCase(), a]));

  function getAssignment(code: string): Assignment | undefined {
    return assignmentMap.get(code.toUpperCase());
  }

  function handleLinkExisting(referralCode: string, partnerId: string) {
    const updated = assignments.filter(
      (a) => a.referralCode.toUpperCase() !== referralCode.toUpperCase(),
    );
    updated.push({ referralCode, partnerId, action: "link" });
    onAssignmentsChange(updated);
  }

  function handleSkip(referralCode: string) {
    const updated = assignments.filter(
      (a) => a.referralCode.toUpperCase() !== referralCode.toUpperCase(),
    );
    updated.push({ referralCode, partnerId: "", action: "skip" });
    onAssignmentsChange(updated);
  }

  function handleUndoAssignment(referralCode: string) {
    const updated = assignments.filter(
      (a) => a.referralCode.toUpperCase() !== referralCode.toUpperCase(),
    );
    onAssignmentsChange(updated);
  }

  async function handleCreatePartner(referralCode: string) {
    const partnerId = await onCreatePartner(newPartnerForm, referralCode);
    if (partnerId) {
      handleLinkExisting(referralCode, partnerId);
      setExpandedCode(null);
      setNewPartnerForm({ name: "", email: "", commissionRate: 0.2 });
    }
  }

  const allAssigned = referralCodes.every((rc) => {
    const a = getAssignment(rc.code);
    return a && (a.action === "skip" || a.partnerId);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {referralCodes.length} referral code{referralCodes.length !== 1 ? "s" : ""} found.
          Assign each to a partner or skip.
        </p>
        {allAssigned && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 bg-green-50 dark:bg-green-950/30 px-2.5 py-1 rounded-full">
            <Check className="w-3 h-3" />
            All assigned
          </span>
        )}
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Referral Code</TableHead>
              <TableHead className="text-right">Subscriptions</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead>Partner</TableHead>
              <TableHead className="w-32">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {referralCodes.map((rc) => {
              const assignment = getAssignment(rc.code);
              const isExpanded = expandedCode === rc.code;

              return (
                <TableRow key={rc.code}>
                  <TableCell>
                    <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                      {rc.code}
                    </code>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {rc.subscriptionCount}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    ${rc.totalRevenue.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    {rc.matchedPartnerId ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-green-600">
                        <Check className="w-3 h-3" />
                        {rc.matchedPartnerName}
                      </span>
                    ) : assignment?.action === "link" ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-green-600">
                        <Check className="w-3 h-3" />
                        {existingPartners.find((p) => p.id === assignment.partnerId)?.name ?? "Assigned"}
                      </span>
                    ) : assignment?.action === "skip" ? (
                      <span className="text-xs text-muted-foreground italic">Skipped</span>
                    ) : (
                      <span className="text-xs text-amber-600 font-medium">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {rc.matchedPartnerId ? (
                      <span className="text-xs text-green-600">Auto-matched</span>
                    ) : assignment ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleUndoAssignment(rc.code)}
                      >
                        Undo
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1">
                        {isExpanded ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setExpandedCode(null)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        ) : (
                          <>
                            <Select
                              value=""
                              onValueChange={(val) => {
                                if (val === "__create__") {
                                  setExpandedCode(rc.code);
                                } else {
                                  handleLinkExisting(rc.code, val);
                                }
                              }}
                            >
                              <SelectTrigger className="h-7 text-xs w-28">
                                <span className="text-muted-foreground">Assign...</span>
                              </SelectTrigger>
                              <SelectContent>
                                {existingPartners.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.name}
                                  </SelectItem>
                                ))}
                                <SelectItem value="__create__">
                                  <span className="flex items-center gap-1.5">
                                    <Plus className="w-3 h-3" />
                                    Create new
                                  </span>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-muted-foreground"
                              onClick={() => handleSkip(rc.code)}
                            >
                              Skip
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Create Partner Inline Form */}
      {expandedCode && (
        <div className="bg-muted/30 rounded-xl p-4 space-y-3 border border-border">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-muted-foreground" />
            <h4 className="text-sm font-medium">
              Create partner for code: <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{expandedCode}</code>
            </h4>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={newPartnerForm.name}
                onChange={(e) => setNewPartnerForm({ ...newPartnerForm, name: e.target.value })}
                placeholder="Partner name"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                value={newPartnerForm.email}
                onChange={(e) => setNewPartnerForm({ ...newPartnerForm, email: e.target.value })}
                placeholder="partner@example.com"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Commission Rate</Label>
              <Input
                type="number"
                min="1"
                max="100"
                value={Math.round(newPartnerForm.commissionRate * 100)}
                onChange={(e) =>
                  setNewPartnerForm({
                    ...newPartnerForm,
                    commissionRate: Number(e.target.value) / 100,
                  })
                }
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => handleCreatePartner(expandedCode)}
              disabled={
                !newPartnerForm.name.trim() ||
                !newPartnerForm.email.trim() ||
                creatingPartner
              }
            >
              {creatingPartner ? "Creating..." : "Create & Assign"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpandedCode(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export type { ReferralCodeGroup, ExistingPartner, Assignment, NewPartnerForm };
export default PartnerAssignmentTable;
