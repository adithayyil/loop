{
  description = "loop: \"Show it once, it does it forever.\" Record a browser task once and replay it in a Steel cloud session.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.git
              # Expose the local app to the Steel cloud browser when needed:
              #   cloudflared tunnel --url http://localhost:3000
              pkgs.cloudflared
            ];

            shellHook = ''
              # Nix system gitconfig rewrites GitHub HTTPS -> SSH and breaks
              # subprocess `git clone` (hit during Steel setup). Keep it neutral.
              export GIT_CONFIG_NOSYSTEM=1
              # playwright-core drives the remote Steel browser over CDP; no
              # local browser download needed at install time.
              export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

              echo "loop dev shell: node $(node --version), npm $(npm --version)"
            '';
          };
        }
      );

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
