# 1. Parse and load variables from the .env file into the environment scope
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        $line = $_.Trim()
        # Skip empty lines and comment lines
        if ($line -and -not $line.StartsWith('#')) {
            if ($line -match '^([^=]+)=(.*)$') {
                $key = $Matches[1].Trim()
                $value = $Matches[2].Trim()
                Set-Item -Path "env:$key" -Value $value
            }
        }
    }
} else {
    Write-Warning "No .env file found. Using existing environment variables."
}

# 2. Safety check for DATABASE_URL
if (-not $env:DATABASE_URL) {
    Write-Error "DATABASE_URL environment variable is missing!"
    exit 1
}

# 3. Read input arguments
$command = $args[0]
$name    = $args[1]

# 4. Command Router
switch ($command) {
    "up" {
        migrate -path migrations -database $env:DATABASE_URL up
    }
    
    "down" {
        $count = if ($name) { $name } else { "1" }
        Write-Host "Rolling back $count migration(s). Continue? [y/N]" -ForegroundColor Yellow
        $confirm = Read-Host
        
        if ($confirm -eq 'y' -or $confirm -eq 'Y') {
            migrate -path migrations -database $env:DATABASE_URL down $count
        } else {
            Write-Host "Rollback cancelled." -ForegroundColor Cyan
        }
    }
    
    "create" {
        if (-not $name) {
            Write-Error "You must provide a name for the migration. Example: .\migrate.ps1 create init_schema"
            exit 1
        }
        migrate create -ext sql -dir migrations -seq $name
    }
    
    "force" {
        if (-not $name) {
            Write-Error "You must provide a version number to force. Example: .\migrate.ps1 force 1"
            exit 1
        }
        migrate -path migrations -database $env:DATABASE_URL force $name
    }
    
    Default {
        Write-Host "Usage: .\migrate.ps1 [up | down [count] | create [name] | force [version]]" -ForegroundColor Green
    }
}
