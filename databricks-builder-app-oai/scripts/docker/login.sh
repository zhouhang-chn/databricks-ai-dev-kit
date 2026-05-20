#!/usr/bin/env bash
# Helper script to login to Azure Container Registry (China)
set -euo pipefail

REGISTRY="azrbrewdatnonprodce2acr"
REGISTRY_SERVER="${REGISTRY}.azurecr.cn"

echo "Checking Azure CLI cloud configuration..."
CURRENT_CLOUD=$(az cloud show --query name -o tsv)

if [[ "$CURRENT_CLOUD" != "AzureChinaCloud" ]]; then
  echo "Switching to AzureChinaCloud..."
  az cloud set --name AzureChinaCloud
fi

echo "Checking Azure login status..."
if ! az account show >/dev/null 2>&1; then
  echo "You are not logged in to Azure. Launching 'az login'..."
  echo "Please follow the instructions in your browser to login to Azure China."
  az login
fi

echo "Logging in to ACR: $REGISTRY_SERVER..."
if az acr login --name "$REGISTRY"; then
  echo "Successfully logged in to $REGISTRY_SERVER"
else
  echo "Failed to login to ACR via 'az acr login'."
  echo "You may need to run 'docker login $REGISTRY_SERVER' manually with a Service Principal or Access Key."
fi
