const mongoose = require('mongoose');

const companyLocationSchema = new mongoose.Schema({
  companyId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  locationIds: [{
    type: String
  }]
}, {
  timestamps: true
});

// Find companyId by locationId
companyLocationSchema.statics.findCompanyByLocation = async function(locationId) {
  return await this.findOne({ locationIds: locationId });
};

module.exports = mongoose.model('CompanyLocation', companyLocationSchema);
