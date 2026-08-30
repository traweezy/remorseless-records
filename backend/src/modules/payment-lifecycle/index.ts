import { Module } from "@medusajs/framework/utils"

import { PAYMENT_LIFECYCLE_MODULE } from "./constants"
import PaymentLifecycleModuleService from "./service"

const paymentLifecycleModule = Module(PAYMENT_LIFECYCLE_MODULE, {
  service: PaymentLifecycleModuleService,
})

export default paymentLifecycleModule
