#![allow(non_snake_case)]

use super::ToolArguments::{decodeArguments, decodeConfigArguments, EmptyArguments};
use crate::tools::ToolInvocation::prepareInvocation;
use crate::tools::ToolResultDataClasses::{
    ToolResultData, TtsGetCurrentConfigIdResultData, TtsListConfigsResultData,
    TtsSetCurrentConfigIdResultData,
};
use crate::ToolExecutionManager::{
    PreparedToolInvocation, SharedToolExecutor, ToolCall, ToolEffect, ToolInvocationContext,
};

/// Selects the registered speech configuration operation.
#[derive(Clone, Copy)]
pub(crate) enum TtsToolOperation {
    ListConfigs,
    GetCurrentConfigId,
    SetCurrentConfigId,
}

/// Executes speech configuration operations through the standard tool lifecycle.
pub(crate) struct TtsToolExecutor {
    pub operation: TtsToolOperation,
}

impl SharedToolExecutor for TtsToolExecutor {
    fn prepare<'a>(
        &'a self,
        request: &'a ToolCall,
        context: &'a ToolInvocationContext,
        checkAccess: bool,
    ) -> Result<PreparedToolInvocation<'a>, String> {
        match self.operation {
            TtsToolOperation::ListConfigs => {
                let _: EmptyArguments = decodeArguments(request)?;
                Ok(prepareInvocation(
                    request,
                    checkAccess,
                    ToolEffect::READ,
                    async move {
                        let configs = context.host().runtimeSupport().listTtsConfigs()?;
                        Ok(ToolResultData::TtsListConfigsResultData(
                            TtsListConfigsResultData { configs },
                        ))
                    },
                ))
            }
            TtsToolOperation::GetCurrentConfigId => {
                let _: EmptyArguments = decodeArguments(request)?;
                Ok(prepareInvocation(
                    request,
                    checkAccess,
                    ToolEffect::READ,
                    async move {
                        let configId = context.host().runtimeSupport().getCurrentTtsConfigId()?;
                        Ok(ToolResultData::TtsGetCurrentConfigIdResultData(
                            TtsGetCurrentConfigIdResultData { configId },
                        ))
                    },
                ))
            }
            TtsToolOperation::SetCurrentConfigId => {
                let args = decodeConfigArguments(request)?;
                Ok(prepareInvocation(
                    request,
                    checkAccess,
                    ToolEffect::WRITE,
                    async move {
                        let configId = context
                            .host()
                            .runtimeSupport()
                            .setCurrentTtsConfigId(args.id)?;
                        Ok(ToolResultData::TtsSetCurrentConfigIdResultData(
                            TtsSetCurrentConfigIdResultData { configId },
                        ))
                    },
                ))
            }
        }
    }
}
