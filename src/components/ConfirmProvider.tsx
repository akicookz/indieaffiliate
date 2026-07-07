import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

interface AlertOptions {
  title: string;
  description?: string;
  okText?: string;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: AlertOptions) => Promise<void>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

type DialogState =
  | ({ kind: "confirm" } & ConfirmOptions)
  | ({ kind: "alert" } & AlertOptions)
  | null;

/**
 * Styled replacement for window.confirm / window.alert. Wrap the app once, then
 * call `const { confirm, alert } = useConfirm()`:
 *   if (await confirm({ title, description, destructive: true })) { ... }
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setState(null);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ kind: "confirm", ...options });
    });
  }, []);

  const alert = useCallback((options: AlertOptions) => {
    return new Promise<void>((resolve) => {
      resolverRef.current = () => resolve();
      setState({ kind: "alert", ...options });
    });
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm, alert }}>
      {children}
      <Dialog
        open={!!state}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {state && (
            <>
              <DialogHeader>
                <DialogTitle>{state.title}</DialogTitle>
                {state.description && (
                  <DialogDescription className="whitespace-pre-line">
                    {state.description}
                  </DialogDescription>
                )}
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-2">
                {state.kind === "confirm" && (
                  <Button variant="secondary" onClick={() => settle(false)}>
                    {state.cancelText ?? "Cancel"}
                  </Button>
                )}
                <Button
                  variant={
                    state.kind === "confirm" && state.destructive
                      ? "destructive"
                      : "default"
                  }
                  onClick={() => settle(true)}
                  autoFocus
                >
                  {state.kind === "confirm"
                    ? (state.confirmText ?? "Confirm")
                    : (state.okText ?? "OK")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm must be used within a ConfirmProvider");
  }
  return context;
}
