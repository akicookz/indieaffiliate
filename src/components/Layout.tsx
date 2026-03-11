import { Outlet } from "react-router-dom";
import { AppSidebar } from "./app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { UpgradePrompt } from "./UpgradePrompt";

function Layout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
          </div>
        </header>
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pt-0">
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
