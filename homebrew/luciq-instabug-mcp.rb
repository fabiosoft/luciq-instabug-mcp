class LuciqInstabugMcp < Formula
  desc "Bridge that turns a public Luciq (Instabug) bug-report URL into JSON, raw logs and screenshot — REST + MCP"
  homepage "https://github.com/fabiosoft/luciq-instabug-mcp"
  url "https://github.com/fabiosoft/luciq-instabug-mcp/releases/download/v0.2.0/luciq-instabug-mcp-0.2.0.tar.gz"
  sha256 "REPLACE_WITH_SHA256_FROM_RELEASE"
  license "MIT"

  depends_on "node"

  def install
    libexec.install Dir["*"]

    (bin/"luciq-instabug-mcp").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/dist/src/bin/serve.js" "$@"
    SH

    (bin/"luciq-instabug-mcp-stdio").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/dist/src/bin/mcp-stdio.js" "$@"
    SH
  end

  test do
    port = free_port
    pid = spawn(
      { "PORT" => port.to_s, "HOST" => "127.0.0.1" },
      bin/"luciq-instabug-mcp",
      out: testpath/"out.log",
      err: testpath/"err.log",
    )

    begin
      sleep 2
      assert_equal "ok\n",
                   shell_output("curl -fsSL http://127.0.0.1:#{port}/healthz")
    ensure
      Process.kill("TERM", pid)
      Process.wait(pid)
    end
  end
end
