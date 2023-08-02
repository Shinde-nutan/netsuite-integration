/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/task', 'N/search', 'N/record', 'N/error'], function (task, search, record, error) {
    function execute(context) {
      try {
        var date = new Date();
        
        // Saved Search Id which will export sales order item records
        var searchId = 'customsearch_hc_export_salesorder_item'; 
        
        var savedSearch = search.load({ id: searchId });
    
        // Run the search
        var searchResult = savedSearch.run().getRange({ start: 0, end: 1 });
      
        // If the search returned no results, do not create the CSV file
        if (searchResult.length === 0) {
          log.debug('No results found. Skipping CSV file creation.');
          return;
        }

        var searchTask = task.create({
          taskType: task.TaskType.SEARCH
        });
  
        searchTask.savedSearchId = searchId;

        // Check Sales Order Item CSV Folder is created or not 
        var folderInternalId = search
          .create({
            type: search.Type.FOLDER,
            filters: [['name', 'is', 'Sales Order Item CSV']],
            columns: ['internalid']
          })
          .run()
          .getRange({ start: 0, end: 1 })
          .map(function (result) {
            return result.getValue('internalid');
        })[0];
      
        // Made Sales Order CSV Item folder in NetSuite File Cabinet
        if (folderInternalId == null) {
          var folder = record.create({ type: record.Type.FOLDER});
          folder.setValue({ fieldId: 'name',
                  value: 'Sales Order Item CSV' });
          var folderId = folder.save();
        }
  
        var fileName =  date + '-SalesOrderItemExport.csv';
        var path = 'Sales Order Item CSV/' + fileName;
        searchTask.filePath = path;
  
        var searchTaskId = searchTask.submit();
  
        var taskStatus = task.checkStatus(searchTaskId);

        log.debug("Search task is submitted ! " + taskStatus.status);
        log.debug("Sales Order Item CSV file Successfully Uploaded in NetSuite with file name ! " + fileName);
      } catch (e) {
        log.error({
          title: 'Error in generating sales order item csv files',
          details: e,
        });
        throw error.create({
          name:"Error in generating sales order item csv files",
          message: e
        });
      }
    }
    return {
      execute: execute
    };
  });