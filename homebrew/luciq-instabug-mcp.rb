class LuciqInstabugMcp < Formula
  desc "Fetch JSON, logs and screenshot from a public Luciq bug-report URL"
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

  def caveats
    <<~EOS
      To register the MCP server with Claude Code (stdio transport):
        claude mcp add --scope user luciq -- luciq-instabug-mcp-stdio
        claude mcp list

      Or use the HTTP server (port 8080 by default):
        luciq-instabug-mcp &
        claude mcp add --transport http --scope user luciq http://localhost:8080/mcp
    EOS
  end

  test do
    port = free_port
    pid = spawn(
      { "PORT" => port.to_s, "HOST" => "127.0.0.1" },
      bin/"luciq-instabug-mcp",
      out: File::NULL,
      err: File::NULL,
    )

    begin
      sleep 3
      assert_equal "ok\n",
                   shell_output("curl -fsSL http://127.0.0.1:#{port}/healthz")
    ensure
      Process.kill("TERM", pid)
      Process.wait(pid)
    end
  end
end
