// Add DELETE endpoint for flag deletion
router.delete("/:id", asyncHandler(ModerationController.deleteFlag))

