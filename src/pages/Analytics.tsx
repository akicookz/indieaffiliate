function Analytics() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Analytics</h1>
        <p className="text-foreground/70">
          Detailed insights into your affiliate performance
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            Click Analytics
          </h2>
          <div className="h-64 flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl">
            <p className="text-muted-foreground">Chart will go here</p>
          </div>
        </div>

        <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            Revenue Trends
          </h2>
          <div className="h-64 flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl">
            <p className="text-muted-foreground">Chart will go here</p>
          </div>
        </div>

        <div className="bg-card/60 backdrop-blur-sm border border-border/50 rounded-2xl p-6 lg:col-span-2">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            Top Performing Links
          </h2>
          <div className="space-y-3">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="flex items-center justify-between p-4 bg-background/50 rounded-xl border border-border/30"
              >
                <div>
                  <p className="font-medium text-foreground">
                    Product Link #{item}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    https://example.com/product-{item}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-foreground">
                    {1200 - item * 100} clicks
                  </p>
                  <p className="text-sm text-muted-foreground">
                    ${(500 - item * 50).toFixed(2)} revenue
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Analytics;
