import {
  ArrowRight,
  BarChart3,
  Zap,
  TrendingUp,
  Check,
  Shield,
  Palette,
  Star,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="mx-auto max-w-4xl border-b border-border bg-background sticky top-0 z-50">
        <div className="mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-white" />
              </div>
              <span className="hidden md:inline-block text-xl font-semibold text-primary">
                UnlockAffiliate
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="ghost" className="hidden md:inline-flex" onClick={()=>document.getElementById("features")?.scrollIntoView({behavior:"smooth"})}>
                Features
              </Button>
              <Button variant="ghost" className="hidden md:inline-flex" onClick={()=>document.getElementById("pricing")?.scrollIntoView({behavior:"smooth"})}>
                Pricing
              </Button>
              <Link to="/login">
                <Button variant="ghost">Sign In</Button>
              </Link>
              <Link to="/signup">
                <Button>Launch your program</Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-20 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <Badge
            variant="default"
            className="rounded-full mb-6 px-4 py-1.5"
          >
            <Zap className="w-3 h-3 mr-1" />
            Free until it pays off
          </Badge>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-semibold mb-6 text-foreground leading-[1.05]">
            Launch an affiliate program.{" "}
            <span className="text-primary">Pay nothing until it works.</span>
          </h1>

          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
            The affiliate program built for Stripe SaaS. Track referrals,
            calculate commissions, and pay your partners — free until they bring
            you your first $1,000 in monthly recurring revenue.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link to="/signup">
              <Button size="default">
                Launch your affiliate program for free
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <Link to="/login">
              <Button
                variant="ghost"
                className="border-border/60 bg-card text-primary"
              >
                Sign in
              </Button>
            </Link>
          </div>

          {/* Social Proof */}
          <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground">
            <div className="flex">
              {[1, 2, 3, 4, 5].map((_, i) => (
                <Star
                  strokeWidth={1.5}
                  fill="currentColor"
                  className="w-4 h-4 text-warning"
                  key={i}
                />
              ))}
            </div>
            <span>Helping indie founders reach their first $1k in affiliate revenue</span>
          </div>
        </div>
      </section>

      {/* Screenshot Placeholder Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 relative">
        <div className="max-w-6xl mx-auto">
          <div className="relative">
            {/* Screenshot Container */}
            <div className="bg-card max-h-[500px] border rounded-md overflow-hidden relative p-6 sm:p-8">
              <div className="space-y-4">
                {/* Browser Chrome Mockup */}
                <div className="w-full">
                  <div className="flex items-center gap-3 bg-muted rounded-md px-4 py-2.5 border border-border">
                    <div className="flex shrink-0 space-x-1.5" aria-hidden>
                      <div className="w-3 h-3 bg-red-500 rounded-full" />
                      <div className="w-3 h-3 bg-yellow-500 rounded-full" />
                      <div className="w-3 h-3 bg-green-500 rounded-full" />
                    </div>
                    <div className="flex-1 min-w-0 bg-muted/50 rounded-full px-3 py-1.5 text-xs text-muted-foreground text-center">
                      app.unlockaffiliate.com/dashboard
                    </div>
                  </div>
                </div>

                <img
                  src="/screenshots/dashboard.webp"
                  alt="Dashboard"
                  className="w-full mx-auto object-contain rounded-lg"
                />
              </div>

              {/* Fade overlay */}
              <div className="absolute inset-x-0 bottom-0 h-40 bg-background/80 pointer-events-none"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Bento Grid */}
      <section className="py-20 px-4 sm:px-6 lg:px-8" id="features">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl mb-4 font-heading italic">
              Free and comes with features built-in.
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Designed to help you unlock affiliate revenue without the
              complexity.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Unified Dashboard */}
            <Card className="col-span-1 md:col-span-2">
              <CardHeader>
                <div className="w-12 h-12 bg-muted rounded-md flex items-center justify-center mb-4">
                  <BarChart3 className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-xl">Unified Dashboard</CardTitle>
                <CardDescription>
                  See how your affiliates are performing across all your
                  projects.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <div className="w-12 h-12 bg-positive/10 rounded-md flex items-center justify-center mb-4">
                  <TrendingUp className="w-6 h-6 text-positive" />
                </div>
                <CardTitle>Trends and Insights</CardTitle>
                <CardDescription>
                  Track top performing affiliates, campaigns
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Fraud Detection */}
            <Card>
              <CardHeader>
                <div className="w-12 h-12 bg-negative/10 rounded-md flex items-center justify-center mb-4">
                  <Shield className="w-6 h-6 text-negative" />
                </div>
                <CardTitle>Fraud Detection</CardTitle>
                <CardDescription>
                  Automatically detect and flag self referrals before you do
                  payouts.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="col-span-1 md:col-span-2">
              <CardHeader>
                <div className="w-12 h-12 bg-warning/10 rounded-md flex items-center justify-center mb-4">
                  <Palette className="w-6 h-6 text-warning" />
                </div>
                <CardTitle className="text-xl">
                  Branded partner portal
                </CardTitle>
                <CardDescription>
                  Customize your partner portal to match brand of your each
                  project.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>

          {/* Large Feature Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            {/* Mass Payouts */}
            <Card>
              <CardHeader className="pb-6">
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 bg-muted rounded-md flex items-center justify-center">
                    <img
                      src="/logos/paypal.svg"
                      alt="PayPal"
                      className="w-full h-full"
                    />
                  </div>
                  <div className="w-12 h-12 bg-positive/10 rounded-md flex items-center justify-center -ml-3">
                    <img
                      src="/logos/wise.png"
                      alt="Wise"
                      className="w-10 h-10"
                    />
                  </div>
                </div>
                <CardTitle className="text-xl">
                  Auto and Mass manual payouts
                </CardTitle>
                <CardDescription>Payouts to Paypal and Wise.</CardDescription>
              </CardHeader>
            </Card>

            {/* Payment Integrations */}
            <Card>
              <CardHeader className="pb-6">
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 rounded-md flex items-center justify-center">
                    <img
                      src="/logos/stripe.svg"
                      alt="Stripe"
                      className="w-full h-full"
                    />
                  </div>
                </div>
                <CardTitle className="text-xl">Stripe Integration</CardTitle>
                <CardDescription>
                  Connect Stripe to automatically track conversions and
                  calculate commissions. Paddle support is coming soon.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8" id="pricing">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl mb-4">
              <span className="pr-2 text-primary font-heading italic">
                Unbeatable
              </span>{" "}
              pricing
            </h2>
            <p className="text-xl text-muted-foreground">
              Fair pricing for every stage of your growth journey.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {/* FREE Plan */}
            <Card className="relative flex flex-col">
              <CardHeader className="text-center pb-6">
                <CardTitle className="text-2xl">Starter</CardTitle>
                <CardDescription>Perfect for getting started</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">$0</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  1 project
                  <br />
                  Free until $1,000 referral MRR
                </p>
              </CardHeader>
              <CardContent className="space-y-3 flex-grow flex flex-col">
                <div className="flex-grow space-y-3">
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">1 admin seat</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">
                      Unlimited affiliates & clicks
                    </span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">Default % commission only</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">CSV payout export</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">"Powered-by" footer</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">Community Slack support</span>
                  </div>
                </div>
                <Link to="/signup?plan=free">
                <Button className="w-full mt-6" variant="secondary">
                  Start Free
                </Button>
                </Link>
              </CardContent>
            </Card>

            {/* GROWTH Plan */}
            <Card className="border-primary/30 relative flex flex-col">
              <Badge className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-primary rounded-full text-white">
                Best value
              </Badge>
              <CardHeader className="text-center pb-6">
                <CardTitle className="text-2xl">Growth</CardTitle>
                <CardDescription>For growing businesses</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">$39</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Up to 5 projects
                  <br />
                  No revenue caps or overage fees
                </p>
              </CardHeader>
              <CardContent className="space-y-3 flex-grow flex flex-col">
                <div className="flex-grow space-y-3">
                  <p className="text-sm text-muted-foreground mb-3">
                    Everything in Free, plus:
                  </p>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">3 admin seats</span>
                    <Badge>Coming Soon</Badge>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">Multiple commission rules</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">Coupon codes</span>
                    <Badge>Coming Soon</Badge>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">Basic fraud filters</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">Remove "Powered-by"</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">
                      Zapier / webhook integrations
                    </span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">Email & live-chat support</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">PayPal mass payouts</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">Wise bulk payouts</span>
                  </div>
                </div>
                <Link to="/signup?plan=growth">
                <Button className="w-full mt-6">Start 14-day free trial</Button>
                </Link>
              </CardContent>
            </Card>

            {/* SCALE Plan */}
            <Card className="relative flex flex-col">
              <CardHeader className="text-center pb-6">
                <CardTitle className="text-2xl">Scale</CardTitle>
                <CardDescription>For established businesses</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">$99</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Unlimited projects
                  <br />
                  No revenue caps or overage fees
                </p>
              </CardHeader>
              <CardContent className="space-y-3 flex-grow flex flex-col">
                <div className="flex-grow space-y-3">
                  <p className="text-sm text-muted-foreground mb-3">
                    Everything in Growth, plus:
                  </p>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">10 admin seats</span>
                    <Badge>Coming Soon</Badge>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">Tiered commission levels</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">
                      Automated / scheduled payouts
                    </span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">Custom domain</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">White-label branding</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">Priority support (24h SLA)</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">Advanced fraud monitoring</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="w-4 h-4 text-positive" />
                    <span className="text-sm">Refund sync</span>
                  </div>
                </div>
                <Link to="/signup?plan=scale">
                <Button variant="secondary" className="w-full mt-6">
                  Start 14-day free trial
                </Button>
                </Link>
              </CardContent>
            </Card>
          </div>

          {/* ENTERPRISE Plan - Full Width */}
          <div className="mt-8 max-w-5xl mx-auto">
            <Card className="w-full">
              <CardContent className="py-8 px-8">
                <div className="flex flex-col md:flex-row items-center justify-between">
                  <div className="text-center md:text-left mb-6 md:mb-0">
                    <CardTitle className="text-3xl mb-2">Enterprise</CardTitle>
                    <CardDescription className="text-lg mb-4">
                      Custom solutions for scale
                    </CardDescription>
                    <div className="flex items-baseline justify-center md:justify-start">
                      <span className="text-4xl font-bold">$149+</span>
                      <span className="text-muted-foreground ml-1">/month</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      Unlimited projects & seats • Priority support
                    </p>
                  </div>

                  <div className="flex-1 md:ml-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                      <div className="flex items-center space-x-3">
                        <Check className="w-4 h-4 text-positive" />
                        <span className="text-sm">
                          SSO (SAML/Okta) & advanced RBAC
                        </span>
                      </div>
                      <div className="flex items-center space-x-3">
                        <Check className="w-4 h-4 text-positive" />
                        <span className="text-sm">
                          Dedicated infra & 99.9% SLA
                        </span>
                      </div>
                      <div className="flex items-center space-x-3">
                        <Check className="w-4 h-4 text-positive" />
                        <span className="text-sm">
                          Multi-touch attribution & BI export
                        </span>
                      </div>
                      <div className="flex items-center space-x-3">
                        <Check className="w-4 h-4 text-positive" />
                        <span className="text-sm">
                          White-glove onboarding, account manager
                        </span>
                      </div>
                      <div className="flex items-center space-x-3 md:col-span-2">
                        <Check className="w-4 h-4 text-positive" />
                        <span className="text-sm">
                          Annual invoicing, security review
                        </span>
                      </div>
                    </div>

                    <a
                      href="mailto:hello@unlockaffiliate.com?subject=UnlockAffiliate%20Enterprise"
                      className="inline-block w-full md:w-auto"
                    >
                      <Button
                        size="lg"
                        variant="default"
                        className="w-full md:w-auto"
                      >
                        Contact Sales
                      </Button>
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <Card className="border-primary/20">
            <CardContent className="py-16 px-8">
              <h2 className="text-3xl md:text-4xl mb-4 font-heading italic">
                Ready to grow your revenue?
              </h2>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                It takes 10 minutes to launch your affiliate program.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link to="/signup">
                  <Button size="lg">
                    Launch your program
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                </Link>
                <p className="text-sm text-muted-foreground">
                  No credit card required • Free until $1,000 referral MRR
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12">
        <div className="bg-card p-8 mx-auto max-w-5xl rounded-md border border-border">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center space-x-2 mb-4">
                <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold">UnlockAffiliate</span>
              </div>
              <p className="text-muted-foreground max-w-md">
                Unlock affiliate marketing as a revenue channel. Reach your
                first $1k in affiliate revenue for free.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Product</h3>
              <ul className="space-y-2 text-muted-foreground">
                <li>Features</li>
                <li>Pricing</li>
                <li>Documentation</li>
                <li>API</li>
              </ul>
            </div>
            {/* This section is hidden for now */}
            {/* <div>
              <h3 className="font-semibold mb-4">Company</h3>
              <ul className="space-y-2 text-muted-foreground">
                <li>About</li>
                <li>Blog</li>
                <li>Contact</li>
                <li>Support</li>
              </ul>
            </div> */}
          </div>
          <div className="border-t border-border/40 mt-8 pt-8 text-center text-muted-foreground">
            <p>&copy; 2026 UnlockAffiliate. Unlock your affiliate revenue.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
