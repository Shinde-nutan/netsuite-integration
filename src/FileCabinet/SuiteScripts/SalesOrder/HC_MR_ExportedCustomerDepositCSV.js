/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/record', 'N/search', 'N/sftp', 'N/format', 'N/error'],
    (file, record, search, sftp, format, error) => {
        function uplaodRejectSalesOrderItemCSVFileOnSFTP (salesOrderFileObj, fileName) {
            //Get Custom Record Type SFTP details
            var customRecordSFTPSearch = search.create({
                type: 'customrecord_ns_sftp_configuration',
                columns: [
                    'custrecord_ns_sftp_server',
                    'custrecord_ns_sftp_userid',
                    'custrecord_ns_sftp_port_no',
                    'custrecord_ns_sftp_host_key',
                    'custrecord_ns_sftp_guid',
                    'custrecord_ns_sftp_default_file_dir'
                ]
                
            });
            var sftpSearchResults = customRecordSFTPSearch.run().getRange({
                start: 0,
                end: 1
            });
       
            var sftpSearchResult = sftpSearchResults[0];
            
            var sftpUrl = sftpSearchResult.getValue({
                name: 'custrecord_ns_sftp_server'
            });

            var sftpUserName = sftpSearchResult.getValue({
                name: 'custrecord_ns_sftp_userid'
            });

            var sftpPort = sftpSearchResult.getValue({
                name: 'custrecord_ns_sftp_port_no'
            });

            var hostKey = sftpSearchResult.getValue({
                name: 'custrecord_ns_sftp_host_key'
            });
            
            var sftpKeyId = sftpSearchResult.getValue({
                name: 'custrecord_ns_sftp_guid'
            });

            var sftpDirectory = sftpSearchResult.getValue({
                name: 'custrecord_ns_sftp_default_file_dir'
            });

            sftpDirectory = sftpDirectory + 'salesorder';
            sftpPort = parseInt(sftpPort);

            var connection = sftp.createConnection({
                username: sftpUserName,
                secret: sftpKeyId,
                url: sftpUrl,
                port: sftpPort,
                directory: sftpDirectory,
                hostKey: hostKey
            });
            log.debug("Connection established successfully with SFTP server!");
    
            if (salesOrderFileObj.size > connection.MAX_FILE_SIZE) {
                throw error.create({
                name:"FILE_IS_TOO_BIG",
                message:"The file you are trying to upload is too big"
                });
            }
            connection.upload({
                directory: '/import/orderpayment/',
                file: salesOrderFileObj
            });
            log.debug("Customer Deposit CSV File Uploaded Successfully to SFTP server with file" + fileName);

        }
        
        const getInputData = (inputContext) => {
            var now = format.format({value : new Date(), type: format.Type.DATETIME});
            
            var nowDateParts = now.split(' ');

            var datePart = nowDateParts[0];
            var timePart = nowDateParts[1];
            var ampmPart = nowDateParts[2];
            
            // Remove the seconds from the time part
            var timeWithoutSeconds = timePart.split(':').slice(0, 2).join(':');
            
            var dateStringWithoutSeconds = datePart + ' ' + timeWithoutSeconds + ' ' + ampmPart;
            
            // get last export runtime
            var customRecordSearch = search.create({
                type: 'customrecord_hc_last_runtime_export',
                columns: ['custrecord_cust_deposit_ex_date']
            });
      
            var searchResults = customRecordSearch.run().getRange({
               start: 0,
               end: 1
            });
              
            var searchResult = searchResults[0];
            var lastExportDate = searchResult.getValue({
                name: 'custrecord_cust_deposit_ex_date'
            });

            var lastExportDateParts = lastExportDate.split(' ');
            var lastExportDatePart = lastExportDateParts[0];
            var lastExportTimePart = lastExportDateParts[1];
            var ampmExportPart = lastExportDateParts[2];
            
            // Remove the seconds from the time part
            var lastExportTimeWithoutSeconds = lastExportTimePart.split(':').slice(0, 2).join(':');
            
            var lastExportDateString = lastExportDatePart + ' ' + lastExportTimeWithoutSeconds + ' ' + ampmExportPart;
            
            // Get customer deposit search query
            var customerDepositSearch = search.load({ id: 'customsearch_hc_exp_customer_deposit' });
            
            // Copy the filters from customerDepositSearch into defaultFilters.
            var defaultFilters = customerDepositSearch.filters;

            // Push the customFilters into defaultFilters.

            defaultFilters.push(search.createFilter({
                name: "datecreated",
                operator: search.Operator.WITHIN,
                values: lastExportDateString, dateStringWithoutSeconds
            }));
            // Copy the modified defaultFilters
            customerDepositSearch.filters = defaultFilters;
            
            return customerDepositSearch;
        }        

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            var hcOrderId = contextValues.values.formulatext;
            var internalId = contextValues.values.internalid.value;
            var externalId = contextValues.values.externalid.value;

            //CD Data
            var customerDepositData = {
                "orderId": hcOrderId,
                "internalId": internalId,
                "manualRefNumber": externalId
            };

            mapContext.write({
                key: contextValues.id,
                value: customerDepositData
            });
            
        }

        const reduce = (reduceContext) => {
            var contextValues = JSON.parse(reduceContext.values);
            var soId = reduceContext.key; 

            var content = contextValues.orderId + ',' + contextValues.internalId + ',' + contextValues.manualRefNumber + '\n';
            reduceContext.write(soId, content);
        }
        
        const summarize = (summaryContext) => {
            try {
                var fileLines = 'orderId,internalId,manualRefNumber\n';
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });

                log.debug("====totalRecordsExported=="+totalRecordsExported);

                if (totalRecordsExported > 0) {
                    var fileName =  summaryContext.dateCreated + '-CustomerDepositExport.csv';
                    var salesOrderFileObj = file.create({
                        name: fileName,
                        fileType: file.Type.CSV,
                        contents: fileLines
                    });

                    // call function to upload csv file on SFTP server
                    uplaodRejectSalesOrderItemCSVFileOnSFTP(salesOrderFileObj, fileName);                    
            
                    var currentDate = format.format({value : summaryContext.dateCreated, type: format.Type.DATETIME});

                    //Get Custom Record Type internal id
                    var customRecordHCExSearch = search.create({
                        type: 'customrecord_hc_last_runtime_export',
                        columns: ['internalid']
                    });
                    var searchResults = customRecordHCExSearch.run().getRange({
                        start: 0,
                        end: 1
                    });
                
                    var searchResult = searchResults[0];
                    var lastRuntimeExportInternalId = searchResult.getValue({
                        name: 'internalid'
                    });

                    // save last sales order export date
                    record.submitFields({
                        type: 'customrecord_hc_last_runtime_export',
                        id: lastRuntimeExportInternalId,
                        values: {
                            custrecord_cust_deposit_ex_date : currentDate
                        }
                    });
                }
            } catch (e) {
                log.error({
                  title: 'Error in exporting and uploading customer deposit csv files',
                  details: e,
                });
                throw error.create({
                  name:"Error in exporting and uploading customer deposit csv files",
                  message: e
                });
            }            
        }
        return {getInputData, map, reduce, summarize}
    });