import { Outlet } from "react-router-dom";
import { AppSidebar } from "./app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { UpgradePrompt } from "./UpgradePrompt";

function Layout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <div className="flex min-w-0 flex-1 flex-col gap-4 px-6 py-5">
          <main className="min-h-screen min-w-0">
            <Outlet />
          </main>
        </div>
        <UpgradePrompt />
      </SidebarInset>
    </SidebarProvider>
  );
}

export default Layout;
